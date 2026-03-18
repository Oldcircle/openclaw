import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetsExportCommand } from "./export.js";
import { assetsImportCommand } from "./import.js";

function mockRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

function mockConfig(workspaceDir: string) {
  return {
    agents: {
      defaults: {
        workspace: workspaceDir,
      },
    },
  } as any;
}

describe("assetsExportCommand", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(tmpdir(), "assets-ei-"));
  });

  it("exports an agent card with _meta header", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      'name: "TestAgent"\nidentity: "I am test"\n',
    );

    const outputPath = path.join(workspaceDir, "exported.yaml");
    const runtime = mockRuntime();

    await assetsExportCommand("TestAgent", runtime, {
      output: outputPath,
      config: mockConfig(workspaceDir),
    });

    const exported = await fs.readFile(outputPath, "utf-8");
    const parsed = YAML.parse(exported);
    expect(parsed._meta).toBeDefined();
    expect(parsed._meta.type).toBe("agent-card");
    expect(parsed._meta.version).toBe("1.0");
    expect(parsed._meta.exportedAt).toBeTruthy();
    expect(parsed.name).toBe("TestAgent");
    expect(parsed.identity).toBe("I am test");
    expect(runtime.log).toHaveBeenCalled();
  });

  it("exports a context book", async () => {
    const cbDir = path.join(workspaceDir, "context-books");
    await fs.mkdir(cbDir, { recursive: true });
    await fs.writeFile(
      path.join(cbDir, "coding.yaml"),
      '- name: "ts"\n  content: "Use strict"\n',
    );

    const outputPath = path.join(workspaceDir, "coding-export.yaml");
    const runtime = mockRuntime();

    await assetsExportCommand("coding", runtime, {
      output: outputPath,
      config: mockConfig(workspaceDir),
    });

    const exported = await fs.readFile(outputPath, "utf-8");
    const parsed = YAML.parse(exported);
    expect(parsed._meta.type).toBe("context-book");
    expect(parsed.entries).toHaveLength(1);
  });

  it("throws for non-existent asset", async () => {
    const runtime = mockRuntime();

    await expect(
      assetsExportCommand("nonexistent", runtime, { config: mockConfig(workspaceDir) }),
    ).rejects.toThrow("not found");
  });
});

describe("assetsImportCommand", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(tmpdir(), "assets-ei-"));
  });

  it("imports an exported asset with _meta type", async () => {
    const importFile = path.join(workspaceDir, "import-me.yaml");
    await fs.writeFile(
      importFile,
      '_meta:\n  type: context-book\n  version: "1.0"\nentries:\n  - name: "ts"\n    content: "Use strict"\n',
    );

    const runtime = mockRuntime();

    await assetsImportCommand(importFile, runtime, { config: mockConfig(workspaceDir) });

    const destPath = path.join(workspaceDir, "context-books", "import-me.yaml");
    const exists = await fs
      .access(destPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Imported context-book"));
  });

  it("imports an agent card by content detection", async () => {
    const importFile = path.join(workspaceDir, "my-agent.yaml");
    await fs.writeFile(importFile, 'identity: "I am the agent"\npersonality: "Calm"\n');

    const runtime = mockRuntime();

    await assetsImportCommand(importFile, runtime, { config: mockConfig(workspaceDir) });

    const destPath = path.join(workspaceDir, "agent-card.yaml");
    const content = await fs.readFile(destPath, "utf-8");
    const parsed = YAML.parse(content);
    expect(parsed.identity).toBe("I am the agent");
  });

  it("refuses to overwrite existing without --force", async () => {
    const destPath = path.join(workspaceDir, "agent-card.yaml");
    await fs.writeFile(destPath, 'identity: "original"\n');

    const importFile = path.join(workspaceDir, "new-agent.yaml");
    await fs.writeFile(importFile, 'identity: "new"\n');

    const runtime = mockRuntime();

    await expect(
      assetsImportCommand(importFile, runtime, { config: mockConfig(workspaceDir) }),
    ).rejects.toThrow("already exists");
  });

  it("overwrites with --force", async () => {
    const destPath = path.join(workspaceDir, "agent-card.yaml");
    await fs.writeFile(destPath, 'identity: "original"\n');

    const importFile = path.join(workspaceDir, "new-agent.yaml");
    await fs.writeFile(importFile, 'identity: "new"\n');

    const runtime = mockRuntime();

    await assetsImportCommand(importFile, runtime, {
      config: mockConfig(workspaceDir),
      force: true,
    });

    const content = await fs.readFile(destPath, "utf-8");
    const parsed = YAML.parse(content);
    expect(parsed.identity).toBe("new");
  });

  it("imports a prompt profile by content detection", async () => {
    const importFile = path.join(workspaceDir, "deep-think.yaml");
    await fs.writeFile(
      importFile,
      'temperature: 0.7\nmodules:\n  - content: "Think step by step"\n    enabled: true\n',
    );

    const runtime = mockRuntime();

    await assetsImportCommand(importFile, runtime, { config: mockConfig(workspaceDir) });

    const destPath = path.join(workspaceDir, "prompt-profiles", "deep-think.yaml");
    const exists = await fs
      .access(destPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("strips _meta from imported content", async () => {
    const importFile = path.join(workspaceDir, "exported.yaml");
    await fs.writeFile(
      importFile,
      '_meta:\n  type: prompt-profile\n  version: "1.0"\ntemperature: 0.5\n',
    );

    const runtime = mockRuntime();

    await assetsImportCommand(importFile, runtime, { config: mockConfig(workspaceDir) });

    const destPath = path.join(workspaceDir, "prompt-profiles", "exported.yaml");
    const content = await fs.readFile(destPath, "utf-8");
    const parsed = YAML.parse(content);
    expect(parsed._meta).toBeUndefined();
    expect(parsed.temperature).toBe(0.5);
  });
});
