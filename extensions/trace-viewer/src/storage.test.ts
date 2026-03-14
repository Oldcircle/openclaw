import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TraceStorage } from "./storage.js";
import type { TraceDetail } from "./types.js";

describe("TraceStorage", () => {
  it("writes trace detail and lists summaries", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-storage-"));
    const storage = new TraceStorage({ rootDir });
    const detail: TraceDetail = {
      schemaVersion: 1,
      traceId: "tr_1",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "agent:main:test",
      startedAt: Date.parse("2026-03-13T10:00:00.000Z"),
      endedAt: Date.parse("2026-03-13T10:00:02.000Z"),
      durationMs: 2_000,
      status: "completed",
      provider: "test-provider",
      model: "test-model",
      userMessage: "hello",
      finalReplyPreview: "hi",
      llmCalls: 1,
      toolCalls: 0,
      totalInputTokens: 10,
      totalOutputTokens: 20,
      steps: [],
      warnings: [],
    };

    await storage.writeTrace(detail);

    const list = await storage.listTraces({ limit: 10 });
    const loaded = await storage.getTrace("tr_1");

    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.traceId).toBe("tr_1");
    expect(loaded?.runId).toBe("run-1");
  });
});
