import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTraceCollector } from "./collector.js";
import { TraceStorage } from "./storage.js";

describe("TraceCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists multiple llm rounds for a single run", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-collector-"));
    const storage = new TraceStorage({ rootDir });
    const collector = createTraceCollector({ storage, timeoutMs: 60_000 });
    const sessionCtx = {
      sessionId: "session-1",
      sessionKey: "agent:main:test",
      trigger: "message",
      channelId: "telegram",
    };

    let now = Date.parse("2026-03-14T10:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);

    collector.handlePromptBuild(
      {
        prompt: "find AI news",
        messages: [{ role: "user", content: "find AI news" }],
      } as never,
      sessionCtx as never,
    );

    collector.handleLlmInput(
      {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-5",
        prompt: "prepended context\n\nfind AI news",
        systemPrompt: "be helpful",
        historyMessages: [{ role: "user", content: "find AI news" }],
        imagesCount: 0,
      } as never,
      sessionCtx as never,
    );

    now += 1_200;
    collector.handleLlmOutput(
      {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-5",
        assistantTexts: ["Searching now"],
        usage: { input: 100, output: 20, total: 120 },
      } as never,
      sessionCtx as never,
    );

    now += 300;
    collector.handleLlmInput(
      {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-5",
        prompt: "",
        systemPrompt: "be helpful",
        historyMessages: [
          { role: "user", content: "find AI news" },
          { role: "assistant", content: "Searching now" },
          { role: "toolResult", toolName: "search", content: "HN results" },
        ],
        imagesCount: 0,
      } as never,
      sessionCtx as never,
    );

    now += 900;
    collector.handleLlmOutput(
      {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-5",
        assistantTexts: ["Here are the results"],
        usage: { input: 120, output: 40, total: 160 },
      } as never,
      sessionCtx as never,
    );

    now += 200;
    collector.handleAgentEnd(
      {
        success: true,
        durationMs: 2_600,
        messages: [
          { role: "user", content: "find AI news" },
          { role: "assistant", content: "Searching now" },
          { role: "toolResult", toolName: "search", content: "HN results" },
          { role: "assistant", content: "Here are the results" },
        ],
      } as never,
      sessionCtx as never,
    );

    await vi.waitFor(async () => {
      const list = await collector.list({ limit: 10 });
      expect(list.items).toHaveLength(1);
    });

    const list = await collector.list({ limit: 10 });
    const traceId = list.items[0]?.traceId;
    expect(traceId).toBeDefined();

    const detail = await collector.get(traceId ?? "");
    expect(detail).toMatchObject({
      runId: "run-1",
      sessionId: "session-1",
      status: "completed",
      llmCalls: 2,
      totalInputTokens: 220,
      totalOutputTokens: 60,
      userMessage: "find AI news",
      finalReplyPreview: "Here are the results",
    });

    const promptSteps = detail?.steps.filter((step) => step.type === "prompt") ?? [];
    const llmInputSteps = detail?.steps.filter((step) => step.type === "llm_input") ?? [];
    const llmOutputSteps = detail?.steps.filter((step) => step.type === "llm_output") ?? [];

    expect(promptSteps).toHaveLength(1);
    expect(llmInputSteps).toHaveLength(2);
    expect(llmOutputSteps).toHaveLength(2);
    expect(llmOutputSteps[0]).toMatchObject({ durationMs: 1_200 });
    expect(llmOutputSteps[1]).toMatchObject({ durationMs: 900 });
    expect(detail?.warnings).toEqual([]);
  });
});
