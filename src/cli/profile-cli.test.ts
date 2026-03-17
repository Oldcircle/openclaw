import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runRegisteredCli } from "../test-utils/command-runner.js";

const profileUseCommand = vi.fn().mockResolvedValue(undefined);

vi.mock("../commands/profile.js", () => ({
  profileUseCommand,
}));

describe("profile cli", () => {
  let registerProfileCli: (typeof import("./profile-cli.js"))["registerProfileCli"];

  beforeAll(async () => {
    ({ registerProfileCli } = await import("./profile-cli.js"));
  });

  beforeEach(() => {
    profileUseCommand.mockClear();
  });

  it("passes the selected prompt profile to the command", async () => {
    await runRegisteredCli({
      register: registerProfileCli as (program: Command) => void,
      argv: ["profile", "use", "deep-think"],
    });

    expect(profileUseCommand).toHaveBeenCalledWith(
      "deep-think",
      expect.any(Object),
      expect.objectContaining({ agent: undefined }),
    );
  });

  it("passes --agent through to profile use", async () => {
    await runRegisteredCli({
      register: registerProfileCli as (program: Command) => void,
      argv: ["profile", "--agent", "poe", "use", "deep-think"],
    });

    expect(profileUseCommand).toHaveBeenCalledWith(
      "deep-think",
      expect.any(Object),
      expect.objectContaining({ agent: "poe" }),
    );
  });
});
