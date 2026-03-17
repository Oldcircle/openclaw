import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROMPT_PROFILES_DIRNAME } from "../agents/prompt-profiles.js";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { profileUseCommand } from "./profile.js";

function createRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("profileUseCommand", () => {
  it("creates an agent-card.yaml when missing", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-profile-use-");
    await fs.mkdir(path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME, "deep-think.yaml"),
      'name: "Deep Think"\n',
      "utf8",
    );
    const runtime = createRuntime();

    await profileUseCommand("deep-think", runtime, {
      config: {
        agents: {
          list: [{ id: "default", workspace: workspaceDir }],
        },
      },
    });

    await expect(
      fs.readFile(path.join(workspaceDir, "agent-card.yaml"), "utf8"),
    ).resolves.toContain("default_prompt_profile: deep-think");
    expect(runtime.log).toHaveBeenCalledWith(
      "Agent default: default prompt profile -> deep-think (Deep Think)",
    );
  });

  it("preserves json agent-card format when updating", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-profile-use-");
    await fs.mkdir(path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME, "tooling.json"),
      JSON.stringify({ name: "Tooling" }, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "agent-card.json"),
      JSON.stringify({ name: "Researcher", default_context_book: "coding" }, null, 2),
      "utf8",
    );
    const runtime = createRuntime();

    await profileUseCommand("tooling.json", runtime, {
      config: {
        agents: {
          list: [{ id: "default", workspace: workspaceDir }],
        },
      },
    });

    const next = JSON.parse(await fs.readFile(path.join(workspaceDir, "agent-card.json"), "utf8"));
    expect(next).toEqual({
      name: "Researcher",
      default_context_book: "coding",
      default_prompt_profile: "tooling",
    });
  });

  it("throws when the selected profile does not exist", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-profile-use-");
    const runtime = createRuntime();

    await expect(
      profileUseCommand("missing", runtime, {
        config: {
          agents: {
            list: [{ id: "default", workspace: workspaceDir }],
          },
        },
      }),
    ).rejects.toThrow('default prompt profile "missing"');
  });
});
