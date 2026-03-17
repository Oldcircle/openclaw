import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { resolveAgentCardPromptContext, setAgentCardDefaultPromptProfile } from "./agent-card.js";

describe("resolveAgentCardPromptContext", () => {
  it("builds at-depth prompt entries from Agent Card depth_prompt", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-agent-card-");
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      [
        'name: "Researcher"',
        'default_context_book: "coding-knowledge"',
        'default_prompt_profile: "deep-think"',
        "depth_prompt:",
        '  content: "Always compare options before deciding."',
        "  depth: 2",
        '  role: "system"',
      ].join("\n"),
      "utf8",
    );

    const result = await resolveAgentCardPromptContext({ workspaceDir });

    expect(result.defaultContextBook).toBe("coding-knowledge");
    expect(result.defaultPromptProfile).toBe("deep-think");
    expect(result.atDepthEntries).toEqual([
      {
        name: "Researcher depth_prompt",
        content: "[Agent Card Depth Prompt: Researcher]\nAlways compare options before deciding.",
        depth: 2,
      },
    ]);
  });

  it("falls back to no at-depth entries and warns when Agent Card is invalid", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-agent-card-");
    const warnings: string[] = [];
    await fs.writeFile(path.join(workspaceDir, "agent-card.yaml"), "depth_prompt: [oops", "utf8");

    const result = await resolveAgentCardPromptContext({
      workspaceDir,
      warn: (message) => warnings.push(message),
    });

    expect(result.atDepthEntries).toEqual([]);
    expect(warnings).toEqual([
      `skipping agent card ${path.join(workspaceDir, "agent-card.yaml")} - invalid YAML/JSON document`,
    ]);
  });

  it("updates the existing yaml agent card with default_prompt_profile", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-agent-card-");
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      ['name: "Researcher"', 'default_context_book: "coding-knowledge"'].join("\n"),
      "utf8",
    );

    const result = await setAgentCardDefaultPromptProfile({
      workspaceDir,
      defaultPromptProfile: "deep-think",
    });

    expect(result.created).toBe(false);
    await expect(
      fs.readFile(path.join(workspaceDir, "agent-card.yaml"), "utf8"),
    ).resolves.toContain("default_prompt_profile: deep-think");
  });

  it("creates agent-card.yaml when setting default_prompt_profile into an empty workspace", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-agent-card-");

    const result = await setAgentCardDefaultPromptProfile({
      workspaceDir,
      defaultPromptProfile: "deep-think",
    });

    expect(result.created).toBe(true);
    expect(result.sourcePath).toBe(path.join(workspaceDir, "agent-card.yaml"));
    await expect(fs.readFile(result.sourcePath, "utf8")).resolves.toContain(
      "default_prompt_profile: deep-think",
    );
  });
});
