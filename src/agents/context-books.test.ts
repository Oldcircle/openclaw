import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import {
  CONTEXT_BOOKS_DIRNAME,
  loadContextBookBootstrapFiles,
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
    expect(result.appendSystemContext).toContain("[Context Book: Tail reminder]");
    expect(result.appendSystemContext).toContain("do the thing");
    expect(result.appendSystemContext).not.toContain("always injected elsewhere");
    expect(result.matchedEntryNames).toEqual(["Tail reminder"]);
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

    expect(result.appendSystemContext).toContain("[Context Book: Must keep]");
    expect(result.appendSystemContext).toContain("[Context Book: High priority]");
    expect(result.appendSystemContext).not.toContain("[Context Book: Low priority]");
    expect(result.matchedEntryNames).toEqual(["Must keep", "High priority"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("prompt budget exceeded");
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
    expect(appended).toContain("[Context Book: Background note]");
    expect(appended).toContain("[Context Book: Final reminder]");
    expect(appended.indexOf("[Context Book: Background note]")).toBeLessThan(
      appended.indexOf("[Context Book: Final reminder]"),
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

    expect(result.appendSystemContext).toContain("[Context Book: Telegram main default]");
    expect(result.appendSystemContext).not.toContain("[Context Book: Discord only]");
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
    expect(matched.appendSystemContext).toContain("[Context Book: Vite config helper]");
    expect(matched.appendSystemContext).toContain("[Context Book: Vite no test helper]");

    const excluded = await resolveContextBookPromptContext({
      workspaceDir,
      messages: [{ role: "user", content: "vite test config issue" }],
    });
    expect(excluded.appendSystemContext).toContain("[Context Book: Vite config helper]");
    expect(excluded.appendSystemContext).not.toContain("[Context Book: Vite no test helper]");
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
    expect(groupResult.appendSystemContext).toContain("[Context Book: Group helper]");
    expect(groupResult.appendSystemContext).not.toContain("[Context Book: Direct helper]");

    const directResult = await resolveContextBookPromptContext({
      workspaceDir,
      sessionKey: "agent:main:direct:user-1",
      messages: [{ role: "user", content: "vite issue" }],
    });
    expect(directResult.appendSystemContext).toContain("[Context Book: Direct helper]");
    expect(directResult.appendSystemContext).not.toContain("[Context Book: Group helper]");
  });
});
