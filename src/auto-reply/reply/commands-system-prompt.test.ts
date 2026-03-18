import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace } from "../../test-helpers/workspace.js";
import { resolveCommandsSystemPromptBundle } from "./commands-system-prompt.js";
import type { HandleCommandsParams } from "./commands-types.js";

function makeParams(workspaceDir: string): HandleCommandsParams {
  return {
    command: {
      commandBodyNormalized: "/context detail",
      channel: "telegram",
      senderIsOwner: true,
    },
    sessionKey: "agent:default:main",
    workspaceDir,
    provider: "openai",
    model: "gpt-5",
    elevated: { allowed: false },
    resolvedThinkLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: "off",
    cfg: {},
    ctx: {},
    commandBody: "",
    commandArgs: [],
    sessionEntry: {
      sessionId: "session-1",
    },
  } as unknown as HandleCommandsParams;
}

describe("resolveCommandsSystemPromptBundle", () => {
  it("applies Prompt Profile tool scope and tool preference context", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-command-prompt-profile-");
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.yaml"),
      ['name: "Researcher"', 'default_prompt_profile: "tooling"'].join("\n"),
      "utf8",
    );
    await fs.mkdir(path.join(workspaceDir, "prompt-profiles"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "prompt-profiles", "tooling.yaml"),
      [
        'name: "Tooling"',
        "tools:",
        "  allow:",
        "    - group:web",
        "    - read",
        "  prefer:",
        "    - web_search",
        "output:",
        "  reply_tags: off",
      ].join("\n"),
      "utf8",
    );

    const result = await resolveCommandsSystemPromptBundle(makeParams(workspaceDir));
    const toolNames = result.tools.map((tool) => tool.name);

    expect(toolNames).toContain("read");
    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("web_fetch");
    expect(toolNames).not.toContain("exec");
    expect(result.promptProfileContext.toolPolicy).toEqual({
      allow: ["group:web", "read"],
    });
    expect(result.promptProfileContext.outputPreferences?.replyTags).toBe("off");
    expect(result.systemPrompt).toContain("## Prompt Profile: Tooling / Tool Preferences");
    expect(result.systemPrompt).toContain(
      "Prefer these tools or tool groups when relevant: web_search",
    );
    expect(result.systemPrompt).toContain("Do not include reply tags such as [[reply_to_current]]");
  });
});
