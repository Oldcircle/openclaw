import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listWorkspaceAssets, validateWorkspaceAssets } from "./assets.js";

describe("listWorkspaceAssets", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(tmpdir(), "assets-test-"));
  });

  it("returns empty when workspace has no assets", async () => {
    const assets = await listWorkspaceAssets({ workspaceDir });
    expect(assets).toEqual([]);
  });

  it("lists agent card", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      'name: "Test Agent"\nidentity: "I am test"\n',
    );
    const assets = await listWorkspaceAssets({ workspaceDir });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      type: "agent-card",
      name: "Test Agent",
      fileName: "agent-card.yaml",
      isDefault: true,
    });
  });

  it("lists context books", async () => {
    const cbDir = path.join(workspaceDir, "context-books");
    await fs.mkdir(cbDir, { recursive: true });
    await fs.writeFile(
      path.join(cbDir, "coding.yaml"),
      '- name: "ts-rules"\n  content: "Use strict typing"\n  alwaysActive: true\n',
    );
    const assets = await listWorkspaceAssets({ workspaceDir });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      type: "context-book",
      name: "coding",
      fileName: "coding.yaml",
      isDefault: false,
    });
  });

  it("lists prompt profiles", async () => {
    const ppDir = path.join(workspaceDir, "prompt-profiles");
    await fs.mkdir(ppDir, { recursive: true });
    await fs.writeFile(
      path.join(ppDir, "deep-think.yaml"),
      'temperature: 0.7\nmodules:\n  - content: "Think step by step"\n    enabled: true\n',
    );
    const assets = await listWorkspaceAssets({ workspaceDir });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      type: "prompt-profile",
      name: "deep-think",
      fileName: "deep-think.yaml",
      isDefault: false,
    });
  });

  it("marks default context book from agent card", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      'default_context_book: "coding"\n',
    );
    const cbDir = path.join(workspaceDir, "context-books");
    await fs.mkdir(cbDir, { recursive: true });
    await fs.writeFile(path.join(cbDir, "coding.yaml"), '- name: "ts"\n  content: "x"\n');
    await fs.writeFile(path.join(cbDir, "other.yaml"), '- name: "o"\n  content: "y"\n');

    const assets = await listWorkspaceAssets({ workspaceDir });
    const contextBooks = assets.filter((a) => a.type === "context-book");
    expect(contextBooks).toHaveLength(2);
    expect(contextBooks.find((a) => a.name === "coding")?.isDefault).toBe(true);
    expect(contextBooks.find((a) => a.name === "other")?.isDefault).toBe(false);
  });

  it("marks default prompt profile from agent card", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      'default_prompt_profile: "deep-think"\n',
    );
    const ppDir = path.join(workspaceDir, "prompt-profiles");
    await fs.mkdir(ppDir, { recursive: true });
    await fs.writeFile(path.join(ppDir, "deep-think.yaml"), "temperature: 0.7\n");
    await fs.writeFile(path.join(ppDir, "casual.yaml"), "temperature: 1.0\n");

    const assets = await listWorkspaceAssets({ workspaceDir });
    const profiles = assets.filter((a) => a.type === "prompt-profile");
    expect(profiles).toHaveLength(2);
    expect(profiles.find((a) => a.name === "deep-think")?.isDefault).toBe(true);
    expect(profiles.find((a) => a.name === "casual")?.isDefault).toBe(false);
  });

  it("filters by type", async () => {
    await fs.writeFile(path.join(workspaceDir, "agent-card.yaml"), 'identity: "x"\n');
    const cbDir = path.join(workspaceDir, "context-books");
    await fs.mkdir(cbDir, { recursive: true });
    await fs.writeFile(path.join(cbDir, "coding.yaml"), '- name: "ts"\n  content: "x"\n');

    const contextBooksOnly = await listWorkspaceAssets({
      workspaceDir,
      type: "context-book",
    });
    expect(contextBooksOnly).toHaveLength(1);
    expect(contextBooksOnly[0]?.type).toBe("context-book");
  });

  it("lists all three types together", async () => {
    await fs.writeFile(path.join(workspaceDir, "agent-card.yaml"), 'identity: "x"\n');
    const cbDir = path.join(workspaceDir, "context-books");
    await fs.mkdir(cbDir, { recursive: true });
    await fs.writeFile(path.join(cbDir, "a.yaml"), '- name: "e"\n  content: "c"\n');
    const ppDir = path.join(workspaceDir, "prompt-profiles");
    await fs.mkdir(ppDir, { recursive: true });
    await fs.writeFile(path.join(ppDir, "p.yaml"), "temperature: 0.5\n");

    const assets = await listWorkspaceAssets({ workspaceDir });
    expect(assets).toHaveLength(3);
    const types = assets.map((a) => a.type);
    expect(types).toContain("agent-card");
    expect(types).toContain("context-book");
    expect(types).toContain("prompt-profile");
  });
});

describe("validateWorkspaceAssets", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(tmpdir(), "assets-validate-"));
  });

  it("returns no issues for valid assets", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      'name: "Test"\nidentity: "I am test"\npersonality: "Calm"\ntone: "Direct"\n',
    );
    const cbDir = path.join(workspaceDir, "context-books");
    await fs.mkdir(cbDir, { recursive: true });
    await fs.writeFile(
      path.join(cbDir, "coding.yaml"),
      '- name: "ts"\n  content: "Use strict typing"\n  alwaysActive: true\n',
    );

    const issues = await validateWorkspaceAssets({ workspaceDir });
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });

  it("reports error for invalid YAML", async () => {
    await fs.writeFile(path.join(workspaceDir, "agent-card.yaml"), "{{invalid yaml");
    const issues = await validateWorkspaceAssets({ workspaceDir });
    expect(issues.some((i) => i.level === "error" && i.message.includes("invalid YAML/JSON"))).toBe(
      true,
    );
  });

  it("reports error for agent card that is an array", async () => {
    await fs.writeFile(path.join(workspaceDir, "agent-card.yaml"), "- item: 1\n");
    const issues = await validateWorkspaceAssets({ workspaceDir });
    expect(issues.some((i) => i.level === "error" && i.message.includes("must be an object"))).toBe(
      true,
    );
  });

  it("reports error for wrong field types in agent card", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      "identity: 123\nbehavior_notes: not-an-array\n",
    );
    const issues = await validateWorkspaceAssets({ workspaceDir });
    expect(issues.filter((i) => i.level === "error")).toHaveLength(2);
  });

  it("warns on unknown agent card fields", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      'identity: "test"\nsome_random_field: true\n',
    );
    const issues = await validateWorkspaceAssets({ workspaceDir });
    expect(issues.some((i) => i.level === "warning" && i.message.includes("unknown field"))).toBe(
      true,
    );
  });

  it("reports error for context book entry without content", async () => {
    const cbDir = path.join(workspaceDir, "context-books");
    await fs.mkdir(cbDir, { recursive: true });
    await fs.writeFile(
      path.join(cbDir, "bad.yaml"),
      '- name: "no-content"\n  alwaysActive: true\n',
    );
    const issues = await validateWorkspaceAssets({ workspaceDir });
    expect(
      issues.some((i) => i.level === "error" && i.message.includes("content is required")),
    ).toBe(true);
  });

  it("reports error for prompt profile with invalid temperature", async () => {
    const ppDir = path.join(workspaceDir, "prompt-profiles");
    await fs.mkdir(ppDir, { recursive: true });
    await fs.writeFile(path.join(ppDir, "bad.yaml"), 'temperature: "hot"\n');
    const issues = await validateWorkspaceAssets({ workspaceDir });
    expect(
      issues.some((i) => i.level === "error" && i.message.includes("temperature must be a number")),
    ).toBe(true);
  });

  it("validates specific files only", async () => {
    await fs.writeFile(path.join(workspaceDir, "agent-card.yaml"), "identity: 123\n");
    const cbDir = path.join(workspaceDir, "context-books");
    await fs.mkdir(cbDir, { recursive: true });
    const badFile = path.join(cbDir, "bad.yaml");
    await fs.writeFile(badFile, '- name: "no-content"\n');

    const issues = await validateWorkspaceAssets({
      workspaceDir,
      files: [badFile],
    });
    // Only validates the specified file
    expect(issues.every((i) => i.filePath === badFile)).toBe(true);
  });

  it("reports empty context book as warning", async () => {
    const cbDir = path.join(workspaceDir, "context-books");
    await fs.mkdir(cbDir, { recursive: true });
    await fs.writeFile(path.join(cbDir, "empty.yaml"), "[]\n");
    const issues = await validateWorkspaceAssets({ workspaceDir });
    expect(issues.some((i) => i.level === "warning" && i.message.includes("no entries"))).toBe(
      true,
    );
  });

  it("reports error for prompt profile modules that are not an array", async () => {
    const ppDir = path.join(workspaceDir, "prompt-profiles");
    await fs.mkdir(ppDir, { recursive: true });
    await fs.writeFile(path.join(ppDir, "bad.yaml"), 'modules: "not-array"\n');
    const issues = await validateWorkspaceAssets({ workspaceDir });
    expect(
      issues.some((i) => i.level === "error" && i.message.includes("modules must be an array")),
    ).toBe(true);
  });

  it("warns when prompt profile has both tools.allow and tools.deny", async () => {
    const ppDir = path.join(workspaceDir, "prompt-profiles");
    await fs.mkdir(ppDir, { recursive: true });
    await fs.writeFile(
      path.join(ppDir, "mixed.yaml"),
      "tools:\n  allow:\n    - search\n  deny:\n    - browse\n",
    );
    const issues = await validateWorkspaceAssets({ workspaceDir });
    expect(
      issues.some((i) => i.level === "warning" && i.message.includes("both allow and deny")),
    ).toBe(true);
  });
});
