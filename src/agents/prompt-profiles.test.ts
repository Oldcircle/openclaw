import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import {
  DEFAULT_PROMPT_PROFILES_DIRNAME,
  resolvePromptProfilePromptContext,
} from "./prompt-profiles.js";

describe("resolvePromptProfilePromptContext", () => {
  it("loads enabled modules from the selected default Prompt Profile", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-prompt-profile-");
    const promptProfilesDir = path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME);
    await fs.mkdir(promptProfilesDir, { recursive: true });
    await fs.writeFile(
      path.join(promptProfilesDir, "deep-think.yaml"),
      [
        'name: "Deep Think"',
        "modules:",
        "  - name: Analysis frame",
        "    enabled: true",
        "    order: 10",
        "    position: after_context",
        "    content: |",
        "      Compare options before deciding.",
        "  - name: Final answer",
        "    enabled: true",
        "    position: tail_reminder",
        "    content: |",
        "      End with a concise recommendation.",
        "  - name: Mid-history reminder",
        "    enabled: true",
        "    position: at_depth",
        "    depth: 2",
        "    content: |",
        "      Keep tradeoffs visible.",
      ].join("\n"),
      "utf8",
    );

    const result = await resolvePromptProfilePromptContext({
      workspaceDir,
      defaultPromptProfile: "deep-think",
    });

    expect(result.profileName).toBe("Deep Think");
    expect(result.appendSystemContext).toContain("[Prompt Profile: Deep Think / Analysis frame]");
    expect(result.appendSystemContext).toContain("[Prompt Profile: Deep Think / Final answer]");
    expect(result.matchedModuleNames).toEqual([
      "Analysis frame",
      "Final answer",
      "Mid-history reminder",
    ]);
    expect(result.atDepthEntries).toEqual([
      {
        name: "Deep Think / Mid-history reminder",
        content: "[Prompt Profile: Deep Think / Mid-history reminder]\nKeep tradeoffs visible.",
        depth: 2,
      },
    ]);
  });

  it("warns and returns empty context when the selected Prompt Profile is missing", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-prompt-profile-");
    const warnings: string[] = [];

    const result = await resolvePromptProfilePromptContext({
      workspaceDir,
      defaultPromptProfile: "deep-think",
      warn: (message) => warnings.push(message),
    });

    expect(result.matchedModuleNames).toEqual([]);
    expect(result.moduleEntries).toEqual([]);
    expect(warnings[0]).toContain('default prompt profile "deep-think"');
  });
});
