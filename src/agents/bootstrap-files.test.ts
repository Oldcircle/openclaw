import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearInternalHooks,
  registerInternalHook,
  type AgentBootstrapHookContext,
} from "../hooks/internal-hooks.js";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { resolveBootstrapContextForRun, resolveBootstrapFilesForRun } from "./bootstrap-files.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";

function registerExtraBootstrapFileHook() {
  registerInternalHook("agent:bootstrap", (event) => {
    const context = event.context as AgentBootstrapHookContext;
    context.bootstrapFiles = [
      ...context.bootstrapFiles,
      {
        name: "EXTRA.md",
        path: path.join(context.workspaceDir, "EXTRA.md"),
        content: "extra",
        missing: false,
      } as unknown as WorkspaceBootstrapFile,
    ];
  });
}

function registerMalformedBootstrapFileHook() {
  registerInternalHook("agent:bootstrap", (event) => {
    const context = event.context as AgentBootstrapHookContext;
    context.bootstrapFiles = [
      ...context.bootstrapFiles,
      {
        name: "EXTRA.md",
        filePath: path.join(context.workspaceDir, "BROKEN.md"),
        content: "broken",
        missing: false,
      } as unknown as WorkspaceBootstrapFile,
      {
        name: "EXTRA.md",
        path: 123,
        content: "broken",
        missing: false,
      } as unknown as WorkspaceBootstrapFile,
      {
        name: "EXTRA.md",
        path: "   ",
        content: "broken",
        missing: false,
      } as unknown as WorkspaceBootstrapFile,
    ];
  });
}

describe("resolveBootstrapFilesForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("applies bootstrap hook overrides", async () => {
    registerExtraBootstrapFileHook();

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });

    expect(files.some((file) => file.path === path.join(workspaceDir, "EXTRA.md"))).toBe(true);
  });

  it("drops malformed hook files with missing/invalid paths", async () => {
    registerMalformedBootstrapFileHook();

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const warnings: string[] = [];
    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      warn: (message) => warnings.push(message),
    });

    expect(
      files.every((file) => typeof file.path === "string" && file.path.trim().length > 0),
    ).toBe(true);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('missing or invalid "path" field');
  });

  it("prefers Agent Card persona slots over legacy workspace files", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    await fs.writeFile(path.join(workspaceDir, "SOUL.md"), "legacy soul", "utf8");
    await fs.writeFile(path.join(workspaceDir, "IDENTITY.md"), "legacy identity", "utf8");
    await fs.writeFile(path.join(workspaceDir, "USER.md"), "legacy user", "utf8");
    await fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "legacy agents", "utf8");
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      [
        'identity: "Card identity"',
        'personality: "Card personality"',
        'tone: "Card tone"',
        'user_relationship: "Card user relationship"',
      ].join("\n"),
      "utf8",
    );

    const files = await resolveBootstrapFilesForRun({ workspaceDir });

    const identity = files.find((file) => file.name === "IDENTITY.md");
    const soul = files.find((file) => file.name === "SOUL.md");
    const user = files.find((file) => file.name === "USER.md");
    const agents = files.find((file) => file.name === "AGENTS.md");

    expect(identity?.path).toBe(path.join(workspaceDir, "agent-card.yaml#IDENTITY.md"));
    expect(identity?.content).toContain("Card identity");
    expect(soul?.path).toBe(path.join(workspaceDir, "agent-card.yaml#SOUL.md"));
    expect(soul?.content).toContain("## Personality");
    expect(soul?.content).toContain("Card tone");
    expect(user?.path).toBe(path.join(workspaceDir, "agent-card.yaml#USER.md"));
    expect(user?.content).toContain("Card user relationship");
    expect(agents?.path).toBe(path.join(workspaceDir, "AGENTS.md"));
    expect(agents?.content).toBe("legacy agents");
  });

  it("keeps legacy persona files for fields missing from Agent Card", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    await fs.writeFile(path.join(workspaceDir, "SOUL.md"), "legacy soul", "utf8");
    await fs.writeFile(path.join(workspaceDir, "IDENTITY.md"), "legacy identity", "utf8");
    await fs.writeFile(path.join(workspaceDir, "USER.md"), "legacy user", "utf8");
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      ['identity: "Card identity"'].join("\n"),
      "utf8",
    );

    const files = await resolveBootstrapFilesForRun({ workspaceDir });

    const identity = files.find((file) => file.name === "IDENTITY.md");
    const soul = files.find((file) => file.name === "SOUL.md");
    const user = files.find((file) => file.name === "USER.md");

    expect(identity?.path).toBe(path.join(workspaceDir, "agent-card.yaml#IDENTITY.md"));
    expect(identity?.content).toContain("Card identity");
    expect(soul?.path).toBe(path.join(workspaceDir, "SOUL.md"));
    expect(soul?.content).toBe("legacy soul");
    expect(user?.path).toBe(path.join(workspaceDir, "USER.md"));
    expect(user?.content).toBe("legacy user");
  });

  it("falls back to legacy persona files when Agent Card is invalid", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const warnings: string[] = [];
    await fs.writeFile(path.join(workspaceDir, "SOUL.md"), "legacy soul", "utf8");
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      "identity: [unterminated",
      "utf8",
    );

    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      warn: (message) => warnings.push(message),
    });

    const soul = files.find((file) => file.name === "SOUL.md");

    expect(soul?.path).toBe(path.join(workspaceDir, "SOUL.md"));
    expect(soul?.content).toBe("legacy soul");
    expect(warnings).toEqual([
      `skipping agent card ${path.join(workspaceDir, "agent-card.yaml")} - invalid YAML/JSON document`,
    ]);
  });
});

describe("resolveBootstrapContextForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("returns context files for hook-adjusted bootstrap files", async () => {
    registerExtraBootstrapFileHook();

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const result = await resolveBootstrapContextForRun({ workspaceDir });
    const extra = result.contextFiles.find(
      (file) => file.path === path.join(workspaceDir, "EXTRA.md"),
    );

    expect(extra?.content).toBe("extra");
  });

  it("uses heartbeat-only bootstrap files in lightweight heartbeat mode", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    await fs.writeFile(path.join(workspaceDir, "HEARTBEAT.md"), "check inbox", "utf8");
    await fs.writeFile(path.join(workspaceDir, "SOUL.md"), "persona", "utf8");

    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      contextMode: "lightweight",
      runKind: "heartbeat",
    });

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.name === "HEARTBEAT.md")).toBe(true);
  });

  it("includes always-on Context Book entries for normal sessions", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    await fs.mkdir(path.join(workspaceDir, "context-books"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "context-books", "coding.yaml"),
      [
        "entries:",
        "  - name: Repo rules",
        "    enabled: true",
        "    alwaysActive: true",
        "    order: 5",
        "    content: |",
        "      Use pnpm",
      ].join("\n"),
      "utf8",
    );

    const result = await resolveBootstrapContextForRun({ workspaceDir });
    const contextBookFile = result.bootstrapFiles.find(
      (file) => file.name === "CONTEXT_BOOK:Repo rules",
    );
    const injected = result.contextFiles.find((file) =>
      file.path.includes("coding.yaml#repo-rules"),
    );

    expect(contextBookFile?.content).toBe("Use pnpm");
    expect(injected?.content).toBe("Use pnpm");
  });

  it("uses Agent Card default_context_book to choose the default bootstrap Context Book", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    await fs.mkdir(path.join(workspaceDir, "context-books"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      ['default_context_book: "coding-knowledge"'].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "context-books", "coding-knowledge.yaml"),
      [
        "entries:",
        "  - name: Coding rules",
        "    enabled: true",
        "    alwaysActive: true",
        "    content: |",
        "      Use pnpm",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "context-books", "research.yaml"),
      [
        "entries:",
        "  - name: Research rules",
        "    enabled: true",
        "    alwaysActive: true",
        "    content: |",
        "      Compare sources",
      ].join("\n"),
      "utf8",
    );

    const result = await resolveBootstrapContextForRun({ workspaceDir });

    expect(result.bootstrapFiles.some((file) => file.name === "CONTEXT_BOOK:Coding rules")).toBe(
      true,
    );
    expect(result.bootstrapFiles.some((file) => file.name === "CONTEXT_BOOK:Research rules")).toBe(
      false,
    );
  });

  it("skips Context Book entries for subagent sessions", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    await fs.mkdir(path.join(workspaceDir, "context-books"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "context-books", "coding.yaml"),
      [
        "entries:",
        "  - name: Repo rules",
        "    enabled: true",
        "    alwaysActive: true",
        "    content: |",
        "      Use pnpm",
      ].join("\n"),
      "utf8",
    );

    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      sessionKey: "agent:default:subagent:task-1",
    });

    expect(files.some((file) => file.name.startsWith("CONTEXT_BOOK:"))).toBe(false);
  });

  it("keeps bootstrap context empty in lightweight cron mode", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    await fs.writeFile(path.join(workspaceDir, "HEARTBEAT.md"), "check inbox", "utf8");

    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      contextMode: "lightweight",
      runKind: "cron",
    });

    expect(files).toEqual([]);
  });
});
