export type TraceStatus = "draft" | "running" | "completed" | "failed" | "timed_out";

export type PromptStep = {
  id: string;
  type: "prompt";
  at: number;
  prompt: string;
  messageCount: number;
};

export type LlmInputStep = {
  id: string;
  type: "llm_input";
  at: number;
  provider: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  historyMessagesCount: number;
  imagesCount: number;
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
