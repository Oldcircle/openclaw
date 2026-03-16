import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { resolveAgentCardPromptContext } from "./agent-card.js";

describe("resolveAgentCardPromptContext", () => {
  it("builds at-depth prompt entries from Agent Card depth_prompt", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-agent-card-");
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      [
        'name: "Researcher"',
        "depth_prompt:",
        '  content: "Always compare options before deciding."',
        "  depth: 2",
        '  role: "system"',
      ].join("\n"),
      "utf8",
    );

    const result = await resolveAgentCardPromptContext({ workspaceDir });

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
});
