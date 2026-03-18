export type TraceStatus = "draft" | "running" | "completed" | "failed" | "timed_out";

export type PromptStep = {
  id: string;
  type: "prompt";
  at: number;
  durationMs?: number;
  prompt: string;
  messageCount: number;
};

export type PromptSectionCategory =
  | "tooling"
  | "safety"
  | "workspace"
  | "skills"
  | "messaging"
  | "memory"
  | "context-book"
  | "prompt-profile"
  | "system";

export type AssetContext = {
  agentCard?: {
    name?: string;
    sourcePath: string;
    defaultContextBook?: string;
    defaultPromptProfile?: string;
  };
  contextBooks?: {
    budgetPercent?: number;
    budgetChars?: number;
    usedChars?: number;
    matchedEntries: Array<{ name: string; position: string; chars: number }>;
    skippedEntries: string[];
    bootstrapEntries?: Array<{
      name: string;
      rawChars: number;
      injectedChars: number;
      truncated: boolean;
    }>;
    atDepthEntries?: Array<{ name: string; depth: number; chars: number }>;
  };
  promptProfile?: {
    name: string;
    sourcePath?: string;
    totalChars?: number;
    modules: Array<{ name: string; position: string; depth?: number; chars: number }>;
    atDepthModules?: Array<{ name: string; depth: number; chars: number }>;
    streamParams?: { temperature?: number; maxTokens?: number };
    toolScope?: { allow?: string[]; deny?: string[] };
    preferredTools?: string[];
    outputPreferences?: {
      format?: string;
      sections?: string[];
      style?: string[];
      rules?: string[];
      requireFinalTag?: boolean;
      replyTags?: string;
    };
  };
};

export type PromptSection = {
  name: string;
  chars: number;
  category: PromptSectionCategory;
  contentRef?: string;
};

export type HistoryMessageSummary = {
  role: string;
  chars: number;
  hasToolCall?: boolean;
  hasToolResult?: boolean;
  contentRef?: string;
};

export type LlmInputStep = {
  id: string;
  type: "llm_input";
  at: number;
  durationMs?: number;
  provider: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  historyMessagesCount: number;
  imagesCount: number;
  systemPromptRef?: string;
  derived?: {
    promptChars: number;
    systemPromptChars?: number;
  };
  promptSections?: PromptSection[];
  historyMessageSummaries?: HistoryMessageSummary[];
  assetContext?: AssetContext;
};

export type LlmOutputStep = {
  id: string;
  type: "llm_output";
  at: number;
  durationMs?: number;
  provider: string;
  model: string;
  assistantTexts: string[];
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

export type ToolCallStep = {
  id: string;
  type: "tool_call";
  at: number;
  durationMs?: number;
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
  resultPreview?: string;
  resultFull?: unknown;
  success: boolean;
  error?: string;
};

export type AgentEndStep = {
  id: string;
  type: "agent_end";
  at: number;
  durationMs?: number;
  success: boolean;
  error?: string;
  messagesCount: number;
};

export type ErrorStep = {
  id: string;
  type: "error";
  at: number;
  stage: string;
  message: string;
};

export type TraceStep =
  | PromptStep
  | LlmInputStep
  | LlmOutputStep
  | ToolCallStep
  | AgentEndStep
  | ErrorStep;

export type TraceSummary = {
  schemaVersion: 1;
  traceId: string;
  runId: string;
  sessionId?: string;
  sessionKey?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: TraceStatus;
  provider?: string;
  model?: string;
  trigger?: string;
  channelId?: string;
  userMessage?: string;
  finalReplyPreview?: string;
  llmCalls: number;
  toolCalls: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheReadTokens?: number;
  totalCacheWriteTokens?: number;
  estimatedCostUsd?: number;
  activeAssets?: {
    agentCard?: string;
    contextBook?: string;
    promptProfile?: string;
    contextBookHits?: number;
  };
};

export type TraceDetail = TraceSummary & {
  steps: TraceStep[];
  warnings: string[];
};

export type TraceListResponse = {
  schemaVersion: 1;
  items: TraceSummary[];
  nextCursor?: string;
};

export type TraceHealthResponse = {
  ok: true;
  schemaVersion: 1;
  activeTraces: number;
};

export type TraceListQuery = {
  date?: string;
  sessionKey?: string;
  status?: TraceStatus;
  q?: string;
  limit?: number;
  cursor?: string;
};
