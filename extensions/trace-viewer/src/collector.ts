import crypto from "node:crypto";
import type {
  PluginHookAfterToolCallEvent,
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforeToolCallEvent,
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
  PluginHookToolContext,
  PluginLogger,
} from "openclaw/plugin-sdk";
import type { BlobStore } from "./blob-store.js";
import { TraceStorage } from "./storage.js";
import { previewUnknown, sanitizeUnknown, truncateText } from "./truncation.js";
import type {
  AgentEndStep,
  ErrorStep,
  HistoryMessageSummary,
  LlmInputStep,
  LlmOutputStep,
  PromptSection,
  PromptSectionCategory,
  PromptStep,
  ToolCallStep,
  TraceDetail,
  TraceListQuery,
  TraceListResponse,
  TraceHealthResponse,
  TraceStep,
  TraceSummary,
} from "./types.js";

type CreateCollectorParams = {
  storage: TraceStorage;
  blobStore?: BlobStore;
  logger?: PluginLogger;
  timeoutMs?: number;
  continuationGraceMs?: number;
};

type PromptSnapshot = {
  at: number;
  sessionId?: string;
  sessionKey?: string;
  prompt: string;
  messageCount: number;
};

type PendingToolCall = {
  at: number;
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
};

type ActiveTrace = {
  detail: TraceDetail;
  llmInputQueue: Array<{ step: LlmInputStep; at: number }>;
  pendingToolCalls: Map<string, PendingToolCall[]>;
  lastTouchedAt: number;
  nextStep: number;
};

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_CONTINUATION_GRACE_MS = 10 * 60 * 1000;
const TIMEOUT_WARNING = "trace timed out before agent_end was observed";

type ContinuationCandidate = {
  trace: ActiveTrace;
  runId: string;
  expiresAt: number;
};

export function createTraceCollector(params: CreateCollectorParams) {
  return new TraceCollector(params);
}

export class TraceCollector {
  private readonly storage: TraceStorage;
  private readonly blobStore?: BlobStore;
  private readonly logger?: PluginLogger;
  private readonly timeoutMs: number;
  private readonly continuationGraceMs: number;
  private readonly activeTraces = new Map<string, ActiveTrace>();
  private readonly sessionToRunId = new Map<string, string>();
  private readonly promptSnapshots = new Map<string, PromptSnapshot>();
  private readonly continuationCandidates = new Map<string, ContinuationCandidate>();

  constructor(params: CreateCollectorParams) {
    this.storage = params.storage;
    this.blobStore = params.blobStore;
    this.logger = params.logger;
    this.timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.continuationGraceMs = params.continuationGraceMs ?? DEFAULT_CONTINUATION_GRACE_MS;

    const timer = setInterval(
      () => {
        void this.flushTimedOutTraces();
      },
      Math.max(15_000, Math.floor(this.timeoutMs / 2)),
    );
    timer.unref?.();
  }

  handlePromptBuild(event: PluginHookBeforePromptBuildEvent, ctx: PluginHookAgentContext): void {
    const key = this.resolveSessionLookupKey(ctx);
    if (!key) {
      return;
    }
    this.promptSnapshots.set(key, {
      at: Date.now(),
      sessionId: ctx.sessionId,
      sessionKey: ctx.sessionKey,
      prompt: event.prompt,
      messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
    });
  }

  handleLlmInput(event: PluginHookLlmInputEvent, ctx: PluginHookAgentContext): void {
    const now = Date.now();
    const trace = this.ensureTrace(event.runId, ctx, now);
    const systemPromptRef =
      event.systemPrompt && this.blobStore ? this.blobStore.putSync(event.systemPrompt) : undefined;

    const step = this.pushStep<LlmInputStep>(trace, {
      id: this.nextStepId(trace),
      type: "llm_input",
      at: now,
      provider: event.provider,
      model: event.model,
      prompt: event.prompt,
      systemPrompt: event.systemPrompt,
      systemPromptRef,
      historyMessagesCount: Array.isArray(event.historyMessages) ? event.historyMessages.length : 0,
      imagesCount: event.imagesCount,
      derived: {
        promptChars: event.prompt.length,
        systemPromptChars: event.systemPrompt?.length,
      },
      promptSections: this.parsePromptSectionsWithBlobs(event.systemPrompt),
      historyMessageSummaries: Array.isArray(event.historyMessages)
        ? this.extractHistoryMessageSummariesWithBlobs(event.historyMessages)
        : undefined,
    });

    trace.llmInputQueue.push({ step, at: now });
    trace.detail.provider = event.provider;
    trace.detail.model = event.model;
    trace.detail.status = "running";
    trace.detail.llmCalls += 1;

    const promptSnapshot = this.consumePromptSnapshot(ctx);
    if (promptSnapshot) {
      const promptStep = this.pushStep<PromptStep>(trace, {
        id: this.nextStepId(trace),
        type: "prompt",
        at: promptSnapshot.at,
        durationMs: Math.max(0, now - promptSnapshot.at),
        prompt: promptSnapshot.prompt,
        messageCount: promptSnapshot.messageCount,
      });
      trace.detail.userMessage = truncateText(extractUserMessage(promptStep.prompt), 400);
      trace.detail.startedAt = Math.min(trace.detail.startedAt, promptSnapshot.at);
    } else if (!trace.detail.userMessage) {
      trace.detail.userMessage = truncateText(extractUserMessage(event.prompt), 400);
      trace.detail.warnings.push(
        "prompt snapshot missing; using llm_input.prompt as user message preview",
      );
    }

    this.touchTrace(trace, ctx, now);
  }

  handleLlmOutput(event: PluginHookLlmOutputEvent, ctx: PluginHookAgentContext): void {
    const now = Date.now();
    const trace = this.ensureTrace(event.runId, ctx, now);
    const pending = trace.llmInputQueue.shift();
    const durationMs = pending ? Math.max(0, now - pending.at) : undefined;
    if (pending) {
      pending.step.durationMs = durationMs;
    }
    const step: LlmOutputStep = {
      id: this.nextStepId(trace),
      type: "llm_output",
      at: now,
      durationMs,
      provider: event.provider,
      model: event.model,
      assistantTexts: event.assistantTexts,
      usage: event.usage,
    };

    this.pushStep(trace, step);
    trace.detail.finalReplyPreview = truncateText(lastNonEmpty(event.assistantTexts), 300);
    trace.detail.provider = event.provider;
    trace.detail.model = event.model;
    addUsage(trace.detail, event.usage);
    if (!pending) {
      trace.detail.warnings.push("llm_output observed without a matching llm_input");
    }

    this.touchTrace(trace, ctx, now);
  }

  handleBeforeToolCall(event: PluginHookBeforeToolCallEvent, ctx: PluginHookToolContext): void {
    const now = Date.now();
    if (!ctx.runId) {
      return;
    }
    const trace = this.ensureTrace(
      ctx.runId,
      {
        sessionId: ctx.sessionId,
        sessionKey: ctx.sessionKey,
      },
      now,
    );
    const key = this.toolKey(ctx.runId, event.toolCallId, event.toolName);
    const bucket = trace.pendingToolCalls.get(key) ?? [];
    bucket.push({
      at: now,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      params: event.params,
    });
    trace.pendingToolCalls.set(key, bucket);
    this.touchTrace(trace, { sessionId: ctx.sessionId, sessionKey: ctx.sessionKey }, now);
  }

  handleAfterToolCall(event: PluginHookAfterToolCallEvent, ctx: PluginHookToolContext): void {
    const now = Date.now();
    if (!ctx.runId) {
      return;
    }
    const trace = this.ensureTrace(
      ctx.runId,
      {
        sessionId: ctx.sessionId,
        sessionKey: ctx.sessionKey,
      },
      now,
    );
    const key = this.toolKey(ctx.runId, event.toolCallId, event.toolName);
    const bucket = trace.pendingToolCalls.get(key);
    const pending = bucket?.shift();
    if (bucket && bucket.length === 0) {
      trace.pendingToolCalls.delete(key);
    }

    const step: ToolCallStep = {
      id: this.nextStepId(trace),
      type: "tool_call",
      at: pending?.at ?? Math.max(0, now - (event.durationMs ?? 0)),
      durationMs: event.durationMs,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      params: (pending?.params ?? event.params) as Record<string, unknown>,
      resultPreview: previewUnknown(event.result),
      resultFull: sanitizeUnknown(event.result),
      success: !event.error,
      error: event.error,
    };

    this.pushStep(trace, step);
    trace.detail.toolCalls += 1;
    if (!pending) {
      trace.detail.warnings.push(
        `tool_call ${event.toolName} completed without matching start event`,
      );
    }
    this.touchTrace(trace, { sessionId: ctx.sessionId, sessionKey: ctx.sessionKey }, now);
  }

  handleAgentEnd(event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext): void {
    const now = Date.now();
    const runId = this.resolveRunId(ctx) ?? this.getContinuationCandidate(ctx)?.runId;
    const trace =
      (runId ? this.activeTraces.get(runId) : undefined) ??
      this.getContinuationCandidate(ctx)?.trace;
    if (!runId || !trace) {
      this.logger?.warn?.("trace-viewer: agent_end received without active run mapping");
      return;
    }

    const step: AgentEndStep = {
      id: this.nextStepId(trace),
      type: "agent_end",
      at: now,
      durationMs: event.durationMs,
      success: event.success,
      error: event.error,
      messagesCount: Array.isArray(event.messages) ? event.messages.length : 0,
    };
    this.pushStep(trace, step);

    if (!event.success && event.error) {
      const errorStep: ErrorStep = {
        id: this.nextStepId(trace),
        type: "error",
        at: now,
        stage: "agent_end",
        message: event.error,
      };
      this.pushStep(trace, errorStep);
    }

    removeWarning(trace.detail.warnings, TIMEOUT_WARNING);
    trace.detail.status = event.success ? "completed" : "failed";
    trace.detail.endedAt = now;
    trace.detail.durationMs = now - trace.detail.startedAt;
    this.touchTrace(trace, ctx, now);
    this.clearContinuationCandidate(ctx, trace);

    void this.persistAndClose(runId, trace);
  }

  async list(query: TraceListQuery): Promise<TraceListResponse> {
    const persisted = await this.storage.listMatchingTraces(query);
    const merged = new Map<string, TraceSummary>();

    for (const item of persisted) {
      merged.set(item.traceId, item);
    }
    for (const item of this.listActiveSummaries(query)) {
      merged.set(item.traceId, item);
    }

    const items = Array.from(merged.values()).sort((a, b) => b.startedAt - a.startedAt);
    const offset = decodeCursor(query.cursor);
    const limit = clampLimit(query.limit);
    const page = items.slice(offset, offset + limit);
    const nextCursor =
      offset + limit < items.length ? encodeCursor({ offset: offset + limit }) : undefined;

    return {
      schemaVersion: 1,
      items: page,
      nextCursor,
    };
  }

  async get(traceId: string) {
    for (const trace of this.activeTraces.values()) {
      if (trace.detail.traceId === traceId && isLiveTraceStatus(trace.detail.status)) {
        return this.toLiveDetail(trace.detail);
      }
    }
    return await this.storage.getTrace(traceId);
  }

  async getBlob(hash: string): Promise<string | null> {
    return this.blobStore?.get(hash) ?? null;
  }

  async health(): Promise<TraceHealthResponse> {
    return {
      ok: true,
      schemaVersion: 1,
      activeTraces: this.activeTraces.size,
    };
  }

  private ensureTrace(
    runId: string,
    ctx: Partial<PluginHookAgentContext>,
    now: number,
  ): ActiveTrace {
    const existing = this.activeTraces.get(runId);
    if (existing) {
      return existing;
    }

    const resumed = this.resumeTimedOutTrace(runId, ctx, now);
    if (resumed) {
      return resumed;
    }

    const traceId = `tr_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const detail: TraceDetail = {
      schemaVersion: 1,
      traceId,
      runId,
      sessionId: ctx.sessionId,
      sessionKey: ctx.sessionKey,
      startedAt: now,
      status: "draft",
      trigger: ctx.trigger,
      channelId: ctx.channelId,
      llmCalls: 0,
      toolCalls: 0,
      steps: [],
      warnings: [],
    };
    const trace: ActiveTrace = {
      detail,
      llmInputQueue: [],
      pendingToolCalls: new Map(),
      lastTouchedAt: now,
      nextStep: 1,
    };

    this.activeTraces.set(runId, trace);
    this.bindSession(runId, ctx);
    return trace;
  }

  private pushStep<T extends TraceStep>(trace: ActiveTrace, step: T): T {
    trace.detail.steps.push(step);
    trace.detail.steps.sort((a, b) => a.at - b.at);
    return step;
  }

  private nextStepId(trace: ActiveTrace): string {
    const id = trace.nextStep;
    trace.nextStep += 1;
    return `step_${String(id).padStart(3, "0")}`;
  }

  private touchTrace(trace: ActiveTrace, ctx: Partial<PluginHookAgentContext>, now: number): void {
    trace.lastTouchedAt = now;
    if (!trace.detail.sessionId && ctx.sessionId) {
      trace.detail.sessionId = ctx.sessionId;
    }
    if (!trace.detail.sessionKey && ctx.sessionKey) {
      trace.detail.sessionKey = ctx.sessionKey;
    }
    if (!trace.detail.trigger && ctx.trigger) {
      trace.detail.trigger = ctx.trigger;
    }
    if (!trace.detail.channelId && ctx.channelId) {
      trace.detail.channelId = ctx.channelId;
    }
    this.bindSession(trace.detail.runId, ctx);
    this.clearContinuationCandidate(ctx, trace);
  }

  private bindSession(runId: string, ctx: Partial<PluginHookAgentContext>): void {
    if (ctx.sessionId) {
      this.sessionToRunId.set(`sessionId:${ctx.sessionId}`, runId);
    }
    if (ctx.sessionKey) {
      this.sessionToRunId.set(`sessionKey:${ctx.sessionKey}`, runId);
    }
  }

  private resolveRunId(ctx: Partial<PluginHookAgentContext>): string | undefined {
    if (ctx.sessionId) {
      const runId = this.sessionToRunId.get(`sessionId:${ctx.sessionId}`);
      if (runId) {
        return runId;
      }
    }
    if (ctx.sessionKey) {
      return this.sessionToRunId.get(`sessionKey:${ctx.sessionKey}`);
    }
    return undefined;
  }

  private resolveSessionLookupKey(ctx: Partial<PluginHookAgentContext>): string | undefined {
    if (ctx.sessionId) {
      return `sessionId:${ctx.sessionId}`;
    }
    if (ctx.sessionKey) {
      return `sessionKey:${ctx.sessionKey}`;
    }
    return undefined;
  }

  private consumePromptSnapshot(ctx: Partial<PluginHookAgentContext>): PromptSnapshot | undefined {
    const key = this.resolveSessionLookupKey(ctx);
    if (!key) {
      return undefined;
    }
    const snapshot = this.promptSnapshots.get(key);
    if (!snapshot) {
      return undefined;
    }
    if (Date.now() - snapshot.at > this.timeoutMs) {
      this.promptSnapshots.delete(key);
      return undefined;
    }
    this.promptSnapshots.delete(key);
    return snapshot;
  }

  private peekPromptSnapshot(
    ctx: Partial<PluginHookAgentContext>,
    now: number,
  ): PromptSnapshot | undefined {
    const key = this.resolveSessionLookupKey(ctx);
    if (!key) {
      return undefined;
    }
    const snapshot = this.promptSnapshots.get(key);
    if (!snapshot) {
      return undefined;
    }
    if (now - snapshot.at > this.timeoutMs) {
      this.promptSnapshots.delete(key);
      return undefined;
    }
    return snapshot;
  }

  private toolKey(runId: string, toolCallId: string | undefined, toolName: string): string {
    return `${runId}:${toolCallId ?? toolName}`;
  }

  private listActiveSummaries(query: TraceListQuery): TraceSummary[] {
    const items: TraceSummary[] = [];
    for (const trace of this.activeTraces.values()) {
      if (!isLiveTraceStatus(trace.detail.status)) {
        continue;
      }
      const summary = this.toLiveSummary(trace.detail);
      if (!matchesTraceQuery(summary, query)) {
        continue;
      }
      items.push(summary);
    }
    items.sort((a, b) => b.startedAt - a.startedAt);
    return items;
  }

  private toLiveSummary(detail: TraceDetail): TraceSummary {
    const { steps: _steps, warnings: _warnings, ...summary } = this.toLiveDetail(detail);
    return summary;
  }

  private toLiveDetail(detail: TraceDetail): TraceDetail {
    const now = Date.now();
    const endedAt = detail.endedAt;
    return {
      ...detail,
      steps: detail.steps.map((step) => ({ ...step })),
      warnings: [...detail.warnings],
      durationMs: Math.max(0, (endedAt ?? now) - detail.startedAt),
    };
  }

  private async flushTimedOutTraces(): Promise<void> {
    const now = Date.now();
    const timedOut: Array<{ runId: string; trace: ActiveTrace }> = [];
    for (const [runId, trace] of this.activeTraces) {
      if (now - trace.lastTouchedAt < this.timeoutMs) {
        continue;
      }
      trace.detail.status = "timed_out";
      trace.detail.endedAt = now;
      trace.detail.durationMs = now - trace.detail.startedAt;
      if (!trace.detail.warnings.includes(TIMEOUT_WARNING)) {
        trace.detail.warnings.push(TIMEOUT_WARNING);
      }
      timedOut.push({ runId, trace });
    }

    await Promise.all(
      timedOut.map(async ({ runId, trace }) => {
        await this.persistAndClose(runId, trace);
        this.rememberContinuationCandidate(runId, trace, now);
      }),
    );
  }

  private parsePromptSectionsWithBlobs(systemPrompt?: string): PromptSection[] {
    const sections = parsePromptSections(systemPrompt);
    if (!this.blobStore || !systemPrompt) return sections;

    // Re-parse with content to store blobs
    const lines = systemPrompt.split("\n");
    let currentStart = 0;
    let sectionIdx = 0;
    let inWorkspaceFile = false;

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]?.startsWith("## ")) continue;
      const header = lines[i].slice(3).trim();
      const isWorkspacePath = header.startsWith("/") || header.startsWith("~/");
      if (inWorkspaceFile && isWorkspacePath) continue;

      const content = lines.slice(currentStart, i).join("\n").trim();
      if (content && sectionIdx < sections.length) {
        sections[sectionIdx].contentRef = this.blobStore.putSync(content);
        sectionIdx++;
      }
      currentStart = i + 1;
      inWorkspaceFile = isWorkspacePath;
    }

    const lastContent = lines.slice(currentStart).join("\n").trim();
    if (lastContent && sectionIdx < sections.length) {
      sections[sectionIdx].contentRef = this.blobStore.putSync(lastContent);
    }

    return sections;
  }

  private extractHistoryMessageSummariesWithBlobs(
    historyMessages: unknown[],
  ): HistoryMessageSummary[] {
    const summaries = extractHistoryMessageSummaries(historyMessages);
    if (!this.blobStore) return summaries;

    for (let i = 0; i < historyMessages.length; i++) {
      const msg = historyMessages[i] as Record<string, unknown>;
      const content = msg.content ?? msg;
      const serialized = typeof content === "string" ? content : JSON.stringify(content);
      if (summaries[i]) {
        summaries[i].contentRef = this.blobStore.putSync(serialized);
      }
    }
    return summaries;
  }

  private async persistAndClose(runId: string, trace: ActiveTrace): Promise<void> {
    try {
      if (this.blobStore) {
        await this.blobStore.flushPending();
      }
      await this.storage.writeTrace(trace.detail);
    } catch (error) {
      this.logger?.error?.(`trace-viewer: failed to write trace ${runId}: ${String(error)}`);
      return;
    }

    this.activeTraces.delete(runId);
    if (trace.detail.sessionId) {
      this.sessionToRunId.delete(`sessionId:${trace.detail.sessionId}`);
    }
    if (trace.detail.sessionKey) {
      this.sessionToRunId.delete(`sessionKey:${trace.detail.sessionKey}`);
    }
  }

  private resumeTimedOutTrace(
    runId: string,
    ctx: Partial<PluginHookAgentContext>,
    now: number,
  ): ActiveTrace | undefined {
    this.pruneContinuationCandidates(now);
    if (this.peekPromptSnapshot(ctx, now)) {
      return undefined;
    }

    const candidate = this.getContinuationCandidate(ctx);
    if (!candidate) {
      return undefined;
    }

    const trace = candidate.trace;
    const previousRunId = candidate.runId;

    trace.detail.status = "running";
    trace.detail.endedAt = undefined;
    trace.detail.durationMs = undefined;
    trace.detail.runId = runId;
    trace.lastTouchedAt = now;
    removeWarning(trace.detail.warnings, TIMEOUT_WARNING);
    trace.detail.warnings.push(
      `trace resumed after timeout; continuing under runId ${runId} (previous runId ${previousRunId})`,
    );

    this.activeTraces.set(runId, trace);
    this.bindSession(runId, ctx);
    this.clearContinuationCandidate(ctx, trace);
    return trace;
  }

  private rememberContinuationCandidate(runId: string, trace: ActiveTrace, now: number): void {
    const candidate: ContinuationCandidate = {
      trace,
      runId,
      expiresAt: now + this.continuationGraceMs,
    };
    for (const key of this.getSessionLookupKeys(trace.detail)) {
      this.continuationCandidates.set(key, candidate);
    }
  }

  private getContinuationCandidate(
    ctx: Partial<PluginHookAgentContext>,
  ): ContinuationCandidate | undefined {
    for (const key of this.getSessionLookupKeys(ctx)) {
      const candidate = this.continuationCandidates.get(key);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }

  private clearContinuationCandidate(
    ctx: Partial<PluginHookAgentContext>,
    trace?: ActiveTrace,
  ): void {
    for (const key of this.getSessionLookupKeys(ctx)) {
      const candidate = this.continuationCandidates.get(key);
      if (!candidate) {
        continue;
      }
      if (trace && candidate.trace !== trace) {
        continue;
      }
      this.continuationCandidates.delete(key);
    }
  }

  private pruneContinuationCandidates(now: number): void {
    for (const [key, candidate] of this.continuationCandidates) {
      if (candidate.expiresAt <= now) {
        this.continuationCandidates.delete(key);
      }
    }
  }

  private getSessionLookupKeys(
    ctx: Partial<Pick<PluginHookAgentContext, "sessionId" | "sessionKey">>,
  ): string[] {
    const keys: string[] = [];
    if (ctx.sessionId) {
      keys.push(`sessionId:${ctx.sessionId}`);
    }
    if (ctx.sessionKey) {
      keys.push(`sessionKey:${ctx.sessionKey}`);
    }
    return keys;
  }
}

function add(target: number | undefined, value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return target;
  }
  return (target ?? 0) + (value as number);
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.floor(limit as number)));
}

function decodeCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { offset?: unknown };
    return Number.isFinite(payload.offset) && (payload.offset as number) >= 0
      ? (payload.offset as number)
      : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(payload: { offset: number }): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function addUsage(detail: TraceDetail, usage: LlmOutputStep["usage"]): void {
  if (!usage) {
    return;
  }
  detail.totalInputTokens = add(detail.totalInputTokens, usage.input);
  detail.totalOutputTokens = add(detail.totalOutputTokens, usage.output);
  detail.totalCacheReadTokens = add(detail.totalCacheReadTokens, usage.cacheRead);
  detail.totalCacheWriteTokens = add(detail.totalCacheWriteTokens, usage.cacheWrite);
}

function lastNonEmpty(values: string[]): string | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function removeWarning(warnings: string[], target: string): void {
  const index = warnings.indexOf(target);
  if (index >= 0) {
    warnings.splice(index, 1);
  }
}

function isLiveTraceStatus(status: TraceDetail["status"]): boolean {
  return status === "draft" || status === "running";
}

function matchesTraceQuery(item: TraceSummary, query: TraceListQuery): boolean {
  if (query.date && toDayKey(item.startedAt) !== query.date) {
    return false;
  }
  if (query.sessionKey && item.sessionKey !== query.sessionKey) {
    return false;
  }
  if (query.status && item.status !== query.status) {
    return false;
  }
  if (query.q && !matchesQuery(item, query.q)) {
    return false;
  }
  return true;
}

function matchesQuery(item: TraceSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [
    item.traceId,
    item.runId,
    item.sessionKey,
    item.userMessage,
    item.finalReplyPreview,
    item.model,
    item.provider,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(needle));
}

function toDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function categorize(name: string): PromptSectionCategory {
  if (name.startsWith("Context Book: ")) return "context-book";
  if (name.startsWith("Prompt Profile: ")) return "prompt-profile";
  const lower = name.toLowerCase();
  if (lower.includes("tool") || lower.includes("mcp")) return "tooling";
  if (lower.includes("safe") || lower.includes("guard")) return "safety";
  if (lower.includes("skill")) return "skills";
  if (
    lower.includes("messag") ||
    lower.includes("reaction") ||
    lower.includes("silent") ||
    lower.includes("heartbeat")
  )
    return "messaging";
  if (lower.includes("memory")) return "memory";
  if (
    name.startsWith("/") ||
    name.startsWith("~/") ||
    lower.includes("workspace") ||
    lower.includes("documentation")
  )
    return "workspace";
  return "system";
}

// Match `[Context Book: xxx]` or `[Prompt Profile: xxx / yyy]` markers that
// appear on their own line.  These are injected by the asset system and should
// be treated as section boundaries so the viewer can display them individually.
const ASSET_MARKER_RE = /^\[(?:Context Book|Prompt Profile): .+\]$/;

function parseAssetMarkerName(line: string): string | undefined {
  if (!ASSET_MARKER_RE.test(line)) return undefined;
  // Strip outer brackets: "[Context Book: foo]" → "Context Book: foo"
  return line.slice(1, -1);
}

function parsePromptSections(systemPrompt?: string): PromptSection[] {
  if (!systemPrompt) return [];
  const lines = systemPrompt.split("\n");
  const sections: PromptSection[] = [];
  let currentName = "(preamble)";
  let currentStart = 0;
  let inWorkspaceFile = false;

  function flushSection(endLine: number): void {
    const content = lines.slice(currentStart, endLine).join("\n").trim();
    if (content) {
      sections.push({
        name: currentName,
        chars: content.length,
        category: categorize(currentName),
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    // Asset markers: [Context Book: ...] / [Prompt Profile: ...]
    const assetName = parseAssetMarkerName(lines[i].trim());
    if (assetName) {
      flushSection(i);
      currentName = assetName;
      currentStart = i + 1;
      inWorkspaceFile = false;
      continue;
    }

    if (!lines[i]?.startsWith("## ")) continue;
    const header = lines[i].slice(3).trim();
    const isWorkspacePath = header.startsWith("/") || header.startsWith("~/");

    // Workspace file sub-headers (paths) are grouped under the workspace section
    if (inWorkspaceFile && isWorkspacePath) continue;

    flushSection(i);
    currentName = header;
    currentStart = i + 1;
    inWorkspaceFile = isWorkspacePath;
  }

  flushSection(lines.length);
  return sections;
}

function extractHistoryMessageSummaries(historyMessages: unknown[]): HistoryMessageSummary[] {
  return historyMessages.map((msg) => {
    const m = msg as Record<string, unknown>;
    const role = typeof m.role === "string" ? m.role : "unknown";
    const content = m.content ?? m;
    const chars = typeof content === "string" ? content.length : JSON.stringify(content).length;

    // Detect tool_calls in assistant messages
    const hasToolCall =
      role === "assistant" &&
      (Array.isArray(m.tool_calls) ||
        (Array.isArray(m.content) &&
          (m.content as unknown[]).some(
            (block) =>
              typeof block === "object" &&
              block !== null &&
              (block as Record<string, unknown>).type === "tool_use",
          )));

    // Detect tool results
    const hasToolResult =
      role === "user" &&
      Array.isArray(m.content) &&
      (m.content as unknown[]).some(
        (block) =>
          typeof block === "object" &&
          block !== null &&
          (block as Record<string, unknown>).type === "tool_result",
      );

    return {
      role,
      chars,
      ...(hasToolCall ? { hasToolCall: true } : {}),
      ...(hasToolResult ? { hasToolResult: true } : {}),
    };
  });
}

function extractUserMessage(raw?: string): string {
  if (!raw) {
    return "";
  }
  const parts = raw.split(/\n\n(?=\S)/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]?.trim();
    if (!part) {
      continue;
    }
    if (
      !part.startsWith("Conversation info") &&
      !part.startsWith("Sender") &&
      !part.startsWith("```")
    ) {
      return part;
    }
  }
  return raw.trim();
}
