import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import {
  calculateContextBookPromptMaxChars,
  CONTEXT_BOOKS_DIRNAME,
  loadContextBookBootstrapFiles,
  resolveContextBookPromptBudgetPercent,
  resolveContextBookPromptContext,
} from "./context-books.js";

describe("loadContextBookBootstrapFiles", () => {
  it("loads enabled always-on entries from YAML and JSON files in descending order", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "alpha.yaml"),
      [
        "entries:",
        "  - name: Low priority",
        "    enabled: true",
        "    alwaysActive: true",
        "    order: 1",
        "    content: |",
        "      low",
        "  - name: Triggered only",
        "    enabled: true",
        "    keywords: [vite]",
        "    content: |",
        "      skipped",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(contextBooksDir, "beta.json"),
      JSON.stringify({
        entries: [
          {
            name: "High priority",
            enabled: true,
            alwaysActive: true,
            order: 10,
            content: "high",
          },
        ],
      }),
      "utf-8",
    );

    const files = await loadContextBookBootstrapFiles({ workspaceDir });

    expect(files.map((file) => file.name)).toEqual([
      "CONTEXT_BOOK:High priority",
      "CONTEXT_BOOK:Low priority",
    ]);
    expect(files.map((file) => file.content)).toEqual(["high", "low"]);
    expect(files[0]?.path).toContain("beta.json#high-priority");
  });

  it("resolves keyword-triggered prompt context from recent messages", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "depth.yaml"),
      [
        "entries:",
        "  - name: Tail reminder",
        "    enabled: true",
        "    keywords: [vite, react]",
        "    position: tail_reminder",
        "    content: |",
        "      do the thing",
        "  - name: Bootstrap-only",
        "    enabled: true",
        "    alwaysActive: true",
        "    position: before_context",
        "    content: |",
        "      always injected elsewhere",
      ].join("\n"),
      "utf-8",
    );

    const result = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "Please help me fix my vite config." }],
    });

    expect(result.prependSystemContext).toBeUndefined();
    expect(result.atDepthEntries).toEqual([]);
    expect(result.appendSystemContext).toContain("## Context Book: Tail reminder");
    expect(result.appendSystemContext).toContain("do the thing");
    expect(result.appendSystemContext).not.toContain("always injected elsewhere");
    expect(result.matchedEntryNames).toEqual(["Tail reminder"]);
  });

  it("returns at_depth entries separately from append/prepend system context", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "at-depth.yaml"),
      [
        "entries:",
        "  - name: Mid-history reminder",
        "    enabled: true",
        "    keywords: [vite]",
        "    position: at_depth",
        "    depth: 2",
        "    content: |",
        "      remember prior architectural decisions",
        "  - name: Tail reminder",
        "    enabled: true",
        "    keywords: [vite]",
        "    position: tail_reminder",
        "    content: |",
        "      keep the final answer concise",
      ].join("\n"),
      "utf-8",
    );

    const result = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "vite build issue" }],
    });

    expect(result.prependSystemContext).toBeUndefined();
    expect(result.appendSystemContext).toContain("## Context Book: Tail reminder");
    expect(result.atDepthEntries).toEqual([
      {
        name: "Mid-history reminder",
        content: "## Context Book: Mid-history reminder\nremember prior architectural decisions",
        depth: 2,
      },
    ]);
    expect(result.matchedEntryNames).toEqual(["Mid-history reminder", "Tail reminder"]);
  });

  it("limits prompt-context loading to the selected default Context Book", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "coding-knowledge.yaml"),
      [
        "entries:",
        "  - name: Coding helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    position: tail_reminder",
        "    content: |",
        "      keep fixes small",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(contextBooksDir, "research.yaml"),
      [
        "entries:",
        "  - name: Research helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    position: tail_reminder",
        "    content: |",
        "      compare multiple sources",
      ].join("\n"),
      "utf-8",
    );

    const result = await resolveContextBookPromptContext({
      workspaceDir,
      defaultContextBook: "coding-knowledge",
      messages: [{ role: "user", content: "vite build issue" }],
    });

    expect(result.appendSystemContext).toContain("## Context Book: Coding helper");
    expect(result.appendSystemContext).not.toContain("## Context Book: Research helper");
    expect(result.matchedEntryNames).toEqual(["Coding helper"]);
  });

  it("enforces prompt-context budget by skipping lower-priority entries unless ignoreBudget is set", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "budget.yaml"),
      [
        "entries:",
        "  - name: Must keep",
        "    enabled: true",
        "    keywords: [vite]",
        "    ignoreBudget: true",
        "    order: 100",
        "    position: tail_reminder",
        "    content: |",
        "      critical",
        "  - name: High priority",
        "    enabled: true",
        "    keywords: [vite]",
        "    order: 20",
        "    position: tail_reminder",
        "    content: |",
        "      12345678901234567890",
        "  - name: Low priority",
        "    enabled: true",
        "    keywords: [vite]",
        "    order: 1",
        "    position: tail_reminder",
        "    content: |",
        "      abcdefghijklmnopqrstuvwxyz",
      ].join("\n"),
      "utf-8",
    );

    const warnings: string[] = [];
    const result = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "vite issue" }],
      maxChars: 80,
      warn: (message) => warnings.push(message),
    });

    expect(result.appendSystemContext).toContain("## Context Book: Must keep");
    expect(result.appendSystemContext).toContain("## Context Book: High priority");
    expect(result.appendSystemContext).not.toContain("## Context Book: Low priority");
    expect(result.matchedEntryNames).toEqual(["Must keep", "High priority"]);
    expect(result.promptBudgetChars).toBe(80);
    expect(result.promptChars).toBeGreaterThan(0);
    expect(result.skippedEntryNames).toEqual(["Low priority"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("prompt budget exceeded");
  });

  it("honors an explicit zero-char prompt budget", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "zero-budget.yaml"),
      [
        "entries:",
        "  - name: Budgeted note",
        "    enabled: true",
        "    keywords: [vite]",
        "    order: 10",
        "    position: tail_reminder",
        "    content: |",
        "      visible only with budget",
      ].join("\n"),
      "utf-8",
    );

    const result = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "vite issue" }],
      promptBudgetPercent: 0,
      maxChars: 0,
    });

    expect(result.appendSystemContext).toBeUndefined();
    expect(result.matchedEntryNames).toEqual([]);
    expect(result.promptBudgetPercent).toBe(0);
    expect(result.promptBudgetChars).toBe(0);
    expect(result.promptChars).toBe(0);
    expect(result.skippedEntryNames).toEqual(["Budgeted note"]);
  });

  it("keeps after_context entries ahead of tail_reminder entries in appended system context", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "positions.yaml"),
      [
        "entries:",
        "  - name: Background note",
        "    enabled: true",
        "    keywords: [vite]",
        "    position: after_context",
        "    content: |",
        "      inspect project setup first",
        "  - name: Final reminder",
        "    enabled: true",
        "    keywords: [vite]",
        "    position: tail_reminder",
        "    content: |",
        "      keep the answer concise",
      ].join("\n"),
      "utf-8",
    );

    const result = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "vite build issue" }],
    });

    const appended = result.appendSystemContext ?? "";
    expect(appended).toContain("## Context Book: Background note");
    expect(appended).toContain("## Context Book: Final reminder");
    expect(appended.indexOf("## Context Book: Background note")).toBeLessThan(
      appended.indexOf("## Context Book: Final reminder"),
    );
  });

  it("filters prompt context by channel, agentId, and session kind", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "filters.yaml"),
      [
        "entries:",
        "  - name: Telegram main default",
        "    enabled: true",
        "    keywords: [vite]",
        "    channels: [telegram]",
        "    agentIds: [main]",
        "    sessionKinds: [default]",
        "    position: tail_reminder",
        "    content: |",
        "      matched",
        "  - name: Discord only",
        "    enabled: true",
        "    keywords: [vite]",
        "    channels: [discord]",
        "    position: tail_reminder",
        "    content: |",
        "      should not match",
      ].join("\n"),
      "utf-8",
    );

    const result = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "vite build issue" }],
      sessionKey: "agent:main:main",
      agentId: "main",
      channelId: "telegram",
    });

    expect(result.appendSystemContext).toContain("## Context Book: Telegram main default");
    expect(result.appendSystemContext).not.toContain("## Context Book: Discord only");
    expect(result.matchedEntryNames).toEqual(["Telegram main default"]);
  });

  it("filters always-on bootstrap entries by agentId and session kind", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "bootstrap-filters.yaml"),
      [
        "entries:",
        "  - name: Main only",
        "    enabled: true",
        "    alwaysActive: true",
        "    agentIds: [main]",
        "    sessionKinds: [default]",
        "    position: before_context",
        "    content: |",
        "      included",
        "  - name: Subagent only",
        "    enabled: true",
        "    alwaysActive: true",
        "    agentIds: [worker]",
        "    sessionKinds: [subagent]",
        "    position: before_context",
        "    content: |",
        "      excluded",
      ].join("\n"),
      "utf-8",
    );

    const files = await loadContextBookBootstrapFiles({
      workspaceDir,
      sessionKey: "agent:main:main",
      agentId: "main",
    });

    expect(files.map((file) => file.name)).toEqual(["CONTEXT_BOOK:Main only"]);
  });

  it("supports secondary keyword logic for prompt matching", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "secondary.yaml"),
      [
        "entries:",
        "  - name: Vite config helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    secondaryKeywords: [config, build]",
        "    secondaryLogic: AND_ANY",
        "    position: tail_reminder",
        "    content: |",
        "      inspect config and build scripts",
        "  - name: Vite no test helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    secondaryKeywords: [test]",
        "    secondaryLogic: NOT_ANY",
        "    position: tail_reminder",
        "    content: |",
        "      this should only match when tests are not mentioned",
      ].join("\n"),
      "utf-8",
    );

    const matched = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "vite config problem in build pipeline" }],
    });
    expect(matched.appendSystemContext).toContain("## Context Book: Vite config helper");
    expect(matched.appendSystemContext).toContain("## Context Book: Vite no test helper");

    const excluded = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "vite test config issue" }],
    });
    expect(excluded.appendSystemContext).toContain("## Context Book: Vite config helper");
    expect(excluded.appendSystemContext).not.toContain("## Context Book: Vite no test helper");
  });

  it("filters prompt context by chat type", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "chat-types.yaml"),
      [
        "entries:",
        "  - name: Group helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    chatTypes: [group]",
        "    position: tail_reminder",
        "    content: |",
        "      only for group chats",
        "  - name: Direct helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    chatTypes: [direct]",
        "    position: tail_reminder",
        "    content: |",
        "      only for direct chats",
      ].join("\n"),
      "utf-8",
    );

    const groupResult = await resolveContextBookPromptContext({
      workspaceDir,
      sessionKey: "agent:main:telegram:group:team-room",
      messages: [{ role: "user", content: "vite issue" }],
    });
    expect(groupResult.appendSystemContext).toContain("## Context Book: Group helper");
    expect(groupResult.appendSystemContext).not.toContain("## Context Book: Direct helper");

    const directResult = await resolveContextBookPromptContext({
      workspaceDir,
      sessionKey: "agent:main:direct:user-1",
      messages: [{ role: "user", content: "vite issue" }],
    });
    expect(directResult.appendSystemContext).toContain("## Context Book: Direct helper");
    expect(directResult.appendSystemContext).not.toContain("## Context Book: Group helper");
  });

  it("keeps only one matched entry from the same group", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "groups.yaml"),
      [
        "entries:",
        "  - name: React specialist",
        "    enabled: true",
        "    keywords: [vite]",
        "    group: frontend-style",
        "    position: tail_reminder",
        "    content: |",
        "      prefer React-first framing",
        "  - name: Vue specialist",
        "    enabled: true",
        "    keywords: [vite]",
        "    group: frontend-style",
        "    position: tail_reminder",
        "    content: |",
        "      prefer Vue-first framing",
        "  - name: Shared helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    position: tail_reminder",
        "    content: |",
        "      always include shared helper",
      ].join("\n"),
      "utf-8",
    );

    const result = await resolveContextBookPromptContext({
      workspaceDir,
      sessionKey: "agent:main:direct:user-1",
      messages: [{ role: "user", content: "vite issue" }],
    });

    const appended = result.appendSystemContext ?? "";
    const groupedMatches = ["React specialist", "Vue specialist"].filter((name) =>
      appended.includes(`## Context Book: ${name}`),
    );
    expect(groupedMatches).toHaveLength(1);
    expect(appended).toContain("## Context Book: Shared helper");
    expect(result.matchedEntryNames).toHaveLength(2);
  });

  it("applies group mutual exclusion to always-on bootstrap entries", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "bootstrap-groups.yaml"),
      [
        "entries:",
        "  - name: Default persona",
        "    enabled: true",
        "    alwaysActive: true",
        "    group: persona",
        "    position: before_context",
        "    content: |",
        "      default persona",
        "  - name: Research persona",
        "    enabled: true",
        "    alwaysActive: true",
        "    group: persona",
        "    position: before_context",
        "    content: |",
        "      research persona",
        "  - name: Safety guard",
        "    enabled: true",
        "    alwaysActive: true",
        "    position: before_context",
        "    content: |",
        "      keep safety rules",
      ].join("\n"),
      "utf-8",
    );

    const files = await loadContextBookBootstrapFiles({
      workspaceDir,
      sessionKey: "agent:main:main",
      agentId: "main",
    });

    const groupedMatches = files
      .map((file) => file.name)
      .filter(
        (name) =>
          name === "CONTEXT_BOOK:Default persona" || name === "CONTEXT_BOOK:Research persona",
      );
    expect(groupedMatches).toHaveLength(1);
    expect(files.map((file) => file.name)).toContain("CONTEXT_BOOK:Safety guard");
  });

  it("limits keyword scanning to the last N messages when scanDepth is set", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "scan-depth.yaml"),
      [
        "entries:",
        "  - name: Recent only",
        "    enabled: true",
        "    keywords: [vite]",
        "    scanDepth: 1",
        "    position: tail_reminder",
        "    content: |",
        "      only matches if vite appears in the last message",
        "  - name: Full history",
        "    enabled: true",
        "    keywords: [webpack]",
        "    position: tail_reminder",
        "    content: |",
        "      matches webpack anywhere in history",
      ].join("\n"),
      "utf-8",
    );

    // "webpack" only appears in an old message; "vite" only in an old message
    const result = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [
        { role: "user", content: "I have a webpack project" },
        { role: "assistant", content: "Let me help with vite migration" },
        { role: "user", content: "Actually I want to keep my current setup" },
      ],
    });

    // Full-history entry should match webpack from old message
    expect(result.matchedEntryNames).toContain("Full history");
    // scanDepth=1 entry should NOT match because "vite" is not in the last message
    expect(result.matchedEntryNames).not.toContain("Recent only");

    // When "vite" appears in the last message, scanDepth=1 should match
    const result2 = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [
        { role: "user", content: "I have a webpack project" },
        { role: "user", content: "Let me try vite instead" },
      ],
    });
    expect(result2.matchedEntryNames).toContain("Recent only");
    expect(result2.matchedEntryNames).toContain("Full history");
  });

  it("truncates entry content to per-entry tokenBudget", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    const longContent = "x".repeat(500);
    await fs.writeFile(
      path.join(contextBooksDir, "token-budget.yaml"),
      [
        "entries:",
        "  - name: Capped entry",
        "    enabled: true",
        "    keywords: [vite]",
        "    tokenBudget: 50",
        "    position: tail_reminder",
        `    content: "${longContent}"`,
        "  - name: Uncapped entry",
        "    enabled: true",
        "    keywords: [vite]",
        "    position: tail_reminder",
        `    content: "${longContent}"`,
      ].join("\n"),
      "utf-8",
    );

    const result = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "vite build" }],
    });

    const appended = result.appendSystemContext ?? "";
    // The capped entry should have truncated content (50 chars of "x")
    expect(appended).toContain("## Context Book: Capped entry");
    expect(appended).toContain("## Context Book: Uncapped entry");
    // Capped entry's x-run should be exactly 50 chars
    const cappedMatch = appended.match(/## Context Book: Capped entry\n(x+)/);
    expect(cappedMatch).toBeTruthy();
    expect(cappedMatch![1].length).toBe(50);
    // Uncapped entry's x-run should be full 500 chars
    const uncappedMatch = appended.match(/## Context Book: Uncapped entry\n(x+)/);
    expect(uncappedMatch).toBeTruthy();
    expect(uncappedMatch![1].length).toBe(500);
  });

  it("keeps a sticky entry active when keyword appeared in recent turns", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "sticky.yaml"),
      [
        "entries:",
        "  - name: Sticky helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    scanDepth: 1",
        "    sticky: 3",
        "    position: tail_reminder",
        "    content: |",
        "      stays active after vite is mentioned",
        "  - name: Narrow helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    scanDepth: 1",
        "    position: tail_reminder",
        "    content: |",
        "      only active when vite is in the last message",
      ].join("\n"),
      "utf-8",
    );

    // "vite" in an older message, not in the last message — but within sticky=3 turns window
    const result = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [
        { role: "user", content: "help me set up vite" },
        { role: "assistant", content: "Sure, here's how..." },
        { role: "user", content: "thanks, now how do I add TypeScript?" },
        { role: "assistant", content: "Add tsconfig.json..." },
        { role: "user", content: "what about CSS modules?" },
      ],
    });

    // Sticky entry should still be active (vite was within last 3*2=6 messages)
    expect(result.matchedEntryNames).toContain("Sticky helper");
    // Narrow entry should NOT match — "vite" is not in the last 1 message
    expect(result.matchedEntryNames).not.toContain("Narrow helper");

    // Now push "vite" out of the sticky window (sticky=3 → scans last 6 messages)
    const result2 = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [
        { role: "user", content: "help me set up vite" },
        { role: "assistant", content: "Sure..." },
        { role: "user", content: "question 1" },
        { role: "assistant", content: "answer 1" },
        { role: "user", content: "question 2" },
        { role: "assistant", content: "answer 2" },
        { role: "user", content: "question 3" },
        { role: "assistant", content: "answer 3" },
        { role: "user", content: "question 4" },
        { role: "assistant", content: "answer 4" },
        { role: "user", content: "final question" },
      ],
    });

    // Sticky entry should NOT be active — "vite" is outside the 6-message window
    expect(result2.matchedEntryNames).not.toContain("Sticky helper");
    // Narrow entry also doesn't match
    expect(result2.matchedEntryNames).not.toContain("Narrow helper");
  });

  it("delays entry activation until the chat has enough turns", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "delay.yaml"),
      [
        "entries:",
        "  - name: Delayed helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    delay: 3",
        "    position: tail_reminder",
        "    content: |",
        "      only activates after 3 user turns",
        "  - name: Immediate helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    position: tail_reminder",
        "    content: |",
        "      activates immediately",
      ].join("\n"),
      "utf-8",
    );

    // Only 1 user turn — delayed entry should NOT activate
    const result1 = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "help me with vite" }],
    });
    expect(result1.matchedEntryNames).not.toContain("Delayed helper");
    expect(result1.matchedEntryNames).toContain("Immediate helper");

    // 3 user turns — delayed entry SHOULD activate
    const result3 = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [
        { role: "user", content: "help me with vite" },
        { role: "assistant", content: "Sure..." },
        { role: "user", content: "more about vite" },
        { role: "assistant", content: "..." },
        { role: "user", content: "vite question" },
      ],
    });
    expect(result3.matchedEntryNames).toContain("Delayed helper");
    expect(result3.matchedEntryNames).toContain("Immediate helper");
  });

  it("biases same-group selection toward higher groupWeight values across sessions", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-context-books-");
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    await fs.mkdir(contextBooksDir, { recursive: true });
    await fs.writeFile(
      path.join(contextBooksDir, "group-weights.yaml"),
      [
        "entries:",
        "  - name: Preferred helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    group: helper-variant",
        "    groupWeight: 20",
        "    position: tail_reminder",
        "    content: |",
        "      higher weight",
        "  - name: Rare helper",
        "    enabled: true",
        "    keywords: [vite]",
        "    group: helper-variant",
        "    groupWeight: 1",
        "    position: tail_reminder",
        "    content: |",
        "      lower weight",
      ].join("\n"),
      "utf-8",
    );

    let preferredCount = 0;
    let rareCount = 0;
    for (let index = 0; index < 64; index += 1) {
      const result = await resolveContextBookPromptContext({
        workspaceDir,
        sessionKey: `agent:main:direct:user-${index}`,
        messages: [{ role: "user", content: "vite issue" }],
      });
      if (result.matchedEntryNames.includes("Preferred helper")) {
        preferredCount += 1;
      }
      if (result.matchedEntryNames.includes("Rare helper")) {
        rareCount += 1;
      }
    }

    expect(preferredCount).toBeGreaterThan(rareCount);
    expect(preferredCount + rareCount).toBe(64);
  });
});

describe("calculateContextBookPromptMaxChars", () => {
  it("falls back to the legacy default when context window is unknown", () => {
    expect(calculateContextBookPromptMaxChars({})).toBe(6_000);
  });

  it("derives a 25% prompt budget from remaining context headroom", () => {
    expect(
      calculateContextBookPromptMaxChars({
        contextWindowTokens: 1_000,
        maxOutputTokens: 200,
        systemPromptChars: 400,
      }),
    ).toBe(700);
  });

  it("respects a configured budget percent", () => {
    expect(
      calculateContextBookPromptMaxChars({
        contextWindowTokens: 1_000,
        maxOutputTokens: 200,
        systemPromptChars: 400,
        budgetPercent: 10,
      }),
    ).toBe(280);
  });
});

describe("resolveContextBookPromptBudgetPercent", () => {
  it("defaults to 25 percent and clamps configured values", () => {
    expect(resolveContextBookPromptBudgetPercent()).toBe(25);
    expect(
      resolveContextBookPromptBudgetPercent({
        agents: { defaults: { contextBookPromptBudgetPercent: 10 } },
      } as never),
    ).toBe(10);
    expect(
      resolveContextBookPromptBudgetPercent({
        agents: { defaults: { contextBookPromptBudgetPercent: 120 } },
      } as never),
    ).toBe(100);
  });
});
