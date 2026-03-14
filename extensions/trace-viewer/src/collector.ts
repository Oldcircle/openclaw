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
import { TraceStorage } from "./storage.js";
import { previewUnknown, sanitizeUnknown, truncateText } from "./truncation.js";
import type {
  AgentEndStep,
  ErrorStep,
  LlmInputStep,
  LlmOutputStep,
  ToolCallStep,
  TraceDetail,
  TraceHealthResponse,
  TraceStep,
} from "./types.js";

type CreateCollectorParams = {
  storage: TraceStorage;
  logger?: PluginLogger;
  timeoutMs?: number;
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
  llmInputQueue: Array<{ stepId: string; at: number }>;
  pendingToolCalls: Map<string, PendingToolCall[]>;
  lastTouchedAt: number;
  nextStep: number;
};

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

export function createTraceCollector(params: CreateCollectorParams) {
  return new TraceCollector(params);
}

export class TraceCollector {
  private readonly storage: TraceStorage;
  private readonly logger?: PluginLogger;
  private readonly timeoutMs: number;
  private readonly activeTraces = new Map<string, ActiveTrace>();
  private readonly sessionToRunId = new Map<string, string>();
  private readonly promptSnapshots = new Map<string, PromptSnapshot>();

  constructor(params: CreateCollectorParams) {
    this.storage = params.storage;
    this.logger = params.logger;
    this.timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
    const step = this.pushStep<LlmInputStep>(trace, {
      id: this.nextStepId(trace),
      type: "llm_input",
      at: now,
      provider: event.provider,
      model: event.model,
      prompt: event.prompt,
      systemPrompt: event.systemPrompt,
      historyMessagesCount: Array.isArray(event.historyMessages) ? event.historyMessages.length : 0,
      imagesCount: event.imagesCount,
    });

    trace.llmInputQueue.push({ stepId: step.id, at: now });
    trace.detail.provider = event.provider;
    trace.detail.model = event.model;
    trace.detail.status = "running";
    trace.detail.llmCalls += 1;

    const promptSnapshot = this.consumePromptSnapshot(ctx);
    if (promptSnapshot) {
      this.pushStep(trace, {
        id: this.nextStepId(trace),
        type: "prompt",
        at: promptSnapshot.at,
        prompt: promptSnapshot.prompt,
        messageCount: promptSnapshot.messageCount,
      });
      trace.detail.userMessage = truncateText(promptSnapshot.prompt, 400);
      trace.detail.startedAt = Math.min(trace.detail.startedAt, promptSnapshot.at);
    } else if (!trace.detail.userMessage) {
      trace.detail.userMessage = truncateText(event.prompt, 400);
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
    const step: LlmOutputStep = {
      id: this.nextStepId(trace),
      type: "llm_output",
      at: now,
      durationMs: pending ? Math.max(0, now - pending.at) : undefined,
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
    const runId = this.resolveRunId(ctx);
    if (!runId) {
      this.logger?.warn?.("trace-viewer: agent_end received without active run mapping");
      return;
    }
    const trace = this.activeTraces.get(runId);
    if (!trace) {
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

    trace.detail.status = event.success ? "completed" : "failed";
    trace.detail.endedAt = now;
    trace.detail.durationMs = now - trace.detail.startedAt;
    this.touchTrace(trace, ctx, now);

    void this.persistAndClose(runId, trace);
  }

  async list(query: Parameters<TraceStorage["listTraces"]>[0]) {
    return await this.storage.listTraces(query);
  }

  async get(traceId: string) {
    return await this.storage.getTrace(traceId);
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

  private toolKey(runId: string, toolCallId: string | undefined, toolName: string): string {
    return `${runId}:${toolCallId ?? toolName}`;
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
      trace.detail.warnings.push("trace timed out before agent_end was observed");
      timedOut.push({ runId, trace });
    }

    await Promise.all(timedOut.map(({ runId, trace }) => this.persistAndClose(runId, trace)));
  }

  private async persistAndClose(runId: string, trace: ActiveTrace): Promise<void> {
    try {
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
}

function add(target: number | undefined, value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return target;
  }
  return (target ?? 0) + (value as number);
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
