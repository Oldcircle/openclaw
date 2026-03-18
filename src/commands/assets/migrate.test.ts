import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetsMigrateCommand } from "./migrate.js";

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

describe("assetsMigrateCommand", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(tmpdir(), "assets-migrate-"));
  });

  it("generates agent card from IDENTITY.md", async () => {
    await fs.writeFile(path.join(workspaceDir, "IDENTITY.md"), "You are a research assistant.");

    const runtime = mockRuntime();
    await assetsMigrateCommand(runtime, { config: mockConfig(workspaceDir) });

    const cardPath = path.join(workspaceDir, "agent-card.yaml");
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = YAML.parse(content);
    expect(parsed.identity).toBe("You are a research assistant.");
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Generated Agent Card"));
  });

  it("generates agent card from SOUL.md", async () => {
    await fs.writeFile(path.join(workspaceDir, "SOUL.md"), "Calm and analytical.");

    const runtime = mockRuntime();
    await assetsMigrateCommand(runtime, { config: mockConfig(workspaceDir) });

    const cardPath = path.join(workspaceDir, "agent-card.yaml");
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = YAML.parse(content);
    expect(parsed.personality).toBe("Calm and analytical.");
  });

  it("generates agent card from USER.md", async () => {
    await fs.writeFile(path.join(workspaceDir, "USER.md"), "The user is the project lead.");

    const runtime = mockRuntime();
    await assetsMigrateCommand(runtime, { config: mockConfig(workspaceDir) });

    const cardPath = path.join(workspaceDir, "agent-card.yaml");
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = YAML.parse(content);
    expect(parsed.user_relationship).toBe("The user is the project lead.");
  });

  it("combines all three files", async () => {
    await fs.writeFile(path.join(workspaceDir, "IDENTITY.md"), "I am Test Agent");
    await fs.writeFile(path.join(workspaceDir, "SOUL.md"), "Friendly and helpful");
    await fs.writeFile(path.join(workspaceDir, "USER.md"), "The boss");

    const runtime = mockRuntime();
    await assetsMigrateCommand(runtime, { config: mockConfig(workspaceDir) });

    const cardPath = path.join(workspaceDir, "agent-card.yaml");
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = YAML.parse(content);
    expect(parsed.identity).toBe("I am Test Agent");
    expect(parsed.personality).toBe("Friendly and helpful");
    expect(parsed.user_relationship).toBe("The boss");
  });

  it("skips when agent card already exists", async () => {
    await fs.writeFile(path.join(workspaceDir, "agent-card.yaml"), "identity: existing\n");
    await fs.writeFile(path.join(workspaceDir, "IDENTITY.md"), "New identity");

    const runtime = mockRuntime();
    await assetsMigrateCommand(runtime, { config: mockConfig(workspaceDir) });

    // Should not overwrite
    const content = await fs.readFile(path.join(workspaceDir, "agent-card.yaml"), "utf-8");
    const parsed = YAML.parse(content);
    expect(parsed.identity).toBe("existing");
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });

  it("reports nothing to migrate when no bootstrap files exist", async () => {
    const runtime = mockRuntime();
    await assetsMigrateCommand(runtime, { config: mockConfig(workspaceDir) });

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Nothing to migrate"));
    const exists = await fs
      .access(path.join(workspaceDir, "agent-card.yaml"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("dry run shows preview without writing", async () => {
    await fs.writeFile(path.join(workspaceDir, "IDENTITY.md"), "I am dry run");

    const runtime = mockRuntime();
    await assetsMigrateCommand(runtime, {
      config: mockConfig(workspaceDir),
      dryRun: true,
    });

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
    const exists = await fs
      .access(path.join(workspaceDir, "agent-card.yaml"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("parses structured SOUL.md with personality and tone", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "SOUL.md"),
      "Personality: Calm and analytical\nTone: Direct and concise\n",
    );

    const runtime = mockRuntime();
    await assetsMigrateCommand(runtime, { config: mockConfig(workspaceDir) });

    const cardPath = path.join(workspaceDir, "agent-card.yaml");
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = YAML.parse(content);
    expect(parsed.personality).toBe("Calm and analytical");
    expect(parsed.tone).toBe("Direct and concise");
  });
});
