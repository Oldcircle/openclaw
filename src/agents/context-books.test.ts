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
});
