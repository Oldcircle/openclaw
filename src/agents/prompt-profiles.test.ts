import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import {
  DEFAULT_PROMPT_PROFILES_DIRNAME,
  mergePromptProfileStreamParams,
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
        "temperature: 0.2",
        "max_tokens: 4096",
        "tools:",
        "  allow:",
        "    - group:web",
        "    - read",
        "  deny:",
        "    - memory_get",
        "  prefer:",
        "    - web_search",
        "    - group:web",
        "output:",
        "  format: markdown",
        "  sections:",
        "    - Summary",
        "    - Risks",
        "  style:",
        "    - concise",
        "    - comparison-first",
        "  require_final_tag: true",
        "  reply_tags: current_only",
        "  rules:",
        "    - Include a recommendation at the end.",
        "    - Call out blockers explicitly.",
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
    expect(result.streamParams).toEqual({
      temperature: 0.2,
      maxTokens: 4096,
    });
    expect(result.toolPolicy).toEqual({
      allow: ["group:web", "read"],
      deny: ["memory_get"],
    });
    expect(result.preferredTools).toEqual(["web_search", "group:web"]);
    expect(result.outputPreferences).toEqual({
      format: "markdown",
      sections: ["Summary", "Risks"],
      style: ["concise", "comparison-first"],
      requireFinalTag: true,
      replyTags: "current_only",
      rules: ["Include a recommendation at the end.", "Call out blockers explicitly."],
    });
    expect(result.appendSystemContext).toContain("## Prompt Profile: Deep Think / Analysis frame");
    expect(result.appendSystemContext).toContain("## Prompt Profile: Deep Think / Final answer");
    expect(result.appendSystemContext).toContain(
      "## Prompt Profile: Deep Think / Tool Preferences",
    );
    expect(result.appendSystemContext).toContain(
      "## Prompt Profile: Deep Think / Output Preferences",
    );
    expect(result.appendSystemContext).toContain(
      "Prefer these tools or tool groups when relevant: web_search, group:web",
    );
    expect(result.appendSystemContext).toContain("Preferred output format: markdown");
    expect(result.appendSystemContext).toContain("Preferred sections: Summary, Risks");
    expect(result.appendSystemContext).toContain("Preferred style: concise, comparison-first");
    expect(result.appendSystemContext).toContain(
      "Wrap the final user-visible answer in <final>...</final>.",
    );
    expect(result.appendSystemContext).toContain("Reply tag policy: current-only");
    expect(result.appendSystemContext).toContain("- Include a recommendation at the end.");
    expect(result.matchedModuleNames).toEqual([
      "Analysis frame",
      "Final answer",
      "Mid-history reminder",
    ]);
    expect(result.atDepthEntries).toEqual([
      {
        name: "Deep Think / Mid-history reminder",
        content: "## Prompt Profile: Deep Think / Mid-history reminder\nKeep tradeoffs visible.",
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

    expect(result.preferredTools).toEqual([]);
    expect(result.matchedModuleNames).toEqual([]);
    expect(result.moduleEntries).toEqual([]);
    expect(warnings[0]).toContain('default prompt profile "deep-think"');
  });

  it("keeps Prompt Profile tool preferences even when no prompt modules are defined", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-prompt-profile-");
    const promptProfilesDir = path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME);
    await fs.mkdir(promptProfilesDir, { recursive: true });
    await fs.writeFile(
      path.join(promptProfilesDir, "tooling.yaml"),
      [
        'name: "Tooling"',
        "tools:",
        "  allow:",
        "    - group:web",
        "  prefer:",
        "    - web_search",
      ].join("\n"),
      "utf8",
    );

    const result = await resolvePromptProfilePromptContext({
      workspaceDir,
      defaultPromptProfile: "tooling",
    });

    expect(result.profileName).toBe("Tooling");
    expect(result.toolPolicy).toEqual({ allow: ["group:web"] });
    expect(result.preferredTools).toEqual(["web_search"]);
    expect(result.matchedModuleNames).toEqual([]);
    expect(result.appendSystemContext).toContain("## Prompt Profile: Tooling / Tool Preferences");
  });

  it("supports output preferences without prompt modules", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-prompt-profile-");
    const promptProfilesDir = path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME);
    await fs.mkdir(promptProfilesDir, { recursive: true });
    await fs.writeFile(
      path.join(promptProfilesDir, "formatting.yaml"),
      [
        'name: "Formatting"',
        "output:",
        "  format: json",
        "  require_final_tag: true",
        "  reply_tags: off",
        "  sections:",
        "    - answer",
        "  rules:",
        "    - Return valid JSON only.",
      ].join("\n"),
      "utf8",
    );

    const result = await resolvePromptProfilePromptContext({
      workspaceDir,
      defaultPromptProfile: "formatting",
    });

    expect(result.profileName).toBe("Formatting");
    expect(result.outputPreferences).toEqual({
      format: "json",
      sections: ["answer"],
      style: [],
      requireFinalTag: true,
      replyTags: "off",
      rules: ["Return valid JSON only."],
    });
    expect(result.appendSystemContext).toContain(
      "## Prompt Profile: Formatting / Output Preferences",
    );
    expect(result.appendSystemContext).toContain("Preferred output format: json");
    expect(result.appendSystemContext).toContain(
      "Wrap the final user-visible answer in <final>...</final>.",
    );
    expect(result.appendSystemContext).toContain("Reply tag policy: disabled");
  });

  it("accepts P3 position aliases from the design doc", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-prompt-profile-");
    const promptProfilesDir = path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME);
    await fs.mkdir(promptProfilesDir, { recursive: true });
    await fs.writeFile(
      path.join(promptProfilesDir, "alias-positions.yaml"),
      [
        "modules:",
        "  - name: Head note",
        "    position: head",
        "    content: |",
        "      Lead with this guidance.",
        "  - name: After history note",
        "    position: after_history",
        "    content: |",
        "      Add this after the main context.",
        "  - name: Tail note",
        "    position: tail",
        "    content: |",
        "      Keep this near the end.",
      ].join("\n"),
      "utf8",
    );

    const result = await resolvePromptProfilePromptContext({
      workspaceDir,
      defaultPromptProfile: "alias-positions",
    });

    expect(result.prependSystemContext).toContain("## Prompt Profile: alias-positions / Head note");
    expect(result.appendSystemContext).toContain(
      "## Prompt Profile: alias-positions / After history note",
    );
    expect(result.appendSystemContext).toContain("## Prompt Profile: alias-positions / Tail note");
    expect(result.moduleEntries).toEqual([
      expect.objectContaining({
        name: "Head note",
        position: "before_context",
        depth: 0,
      }),
      expect.objectContaining({
        name: "After history note",
        position: "after_context",
        depth: 0,
      }),
      expect.objectContaining({
        name: "Tail note",
        position: "tail_reminder",
        depth: 0,
      }),
    ]);
  });
});

describe("mergePromptProfileStreamParams", () => {
  it("uses Prompt Profile stream params as defaults and lets explicit stream params win", () => {
    expect(
      mergePromptProfileStreamParams({
        promptProfileStreamParams: {
          temperature: 0.2,
          maxTokens: 4096,
        },
        streamParams: {
          temperature: 0.7,
        },
      }),
    ).toEqual({
      temperature: 0.7,
      maxTokens: 4096,
    });
  });
});
