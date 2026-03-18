import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runRegisteredCli } from "../test-utils/command-runner.js";

const assetsListCommand = vi.fn().mockResolvedValue(undefined);
const assetsValidateCommand = vi.fn().mockResolvedValue(undefined);

vi.mock("../commands/assets.js", () => ({
  assetsListCommand,
  assetsValidateCommand,
}));

describe("assets cli", () => {
  let registerAssetsCli: (typeof import("./assets-cli.js"))["registerAssetsCli"];

  beforeAll(async () => {
    ({ registerAssetsCli } = await import("./assets-cli.js"));
  });

  beforeEach(() => {
    assetsListCommand.mockClear();
    assetsValidateCommand.mockClear();
  });

  it("calls assetsListCommand for assets list", async () => {
    await runRegisteredCli({
      register: registerAssetsCli as (program: Command) => void,
      argv: ["assets", "list"],
    });

    expect(assetsListCommand).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ agent: undefined, json: false }),
    );
  });

  it("passes --type to list", async () => {
    await runRegisteredCli({
      register: registerAssetsCli as (program: Command) => void,
      argv: ["assets", "list", "--type", "context-book"],
    });

    expect(assetsListCommand).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ type: "context-book" }),
    );
  });

  it("passes --json to list", async () => {
    await runRegisteredCli({
      register: registerAssetsCli as (program: Command) => void,
      argv: ["assets", "list", "--json"],
    });

    expect(assetsListCommand).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ json: true }),
    );
  });

  it("passes --agent to list via parent option", async () => {
    await runRegisteredCli({
      register: registerAssetsCli as (program: Command) => void,
      argv: ["assets", "--agent", "myagent", "list"],
    });

    expect(assetsListCommand).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ agent: "myagent" }),
    );
  });

  it("calls assetsValidateCommand for assets validate", async () => {
    await runRegisteredCli({
      register: registerAssetsCli as (program: Command) => void,
      argv: ["assets", "validate"],
    });

    expect(assetsValidateCommand).toHaveBeenCalledWith(
      expect.any(Object),
      [],
      expect.objectContaining({ agent: undefined, json: false }),
    );
  });

  it("passes files to validate", async () => {
    await runRegisteredCli({
      register: registerAssetsCli as (program: Command) => void,
      argv: ["assets", "validate", "foo.yaml", "bar.json"],
    });

    expect(assetsValidateCommand).toHaveBeenCalledWith(
      expect.any(Object),
      ["foo.yaml", "bar.json"],
      expect.any(Object),
    );
  });

  it("passes --agent to validate via parent option", async () => {
    await runRegisteredCli({
      register: registerAssetsCli as (program: Command) => void,
      argv: ["assets", "--agent", "poe", "validate"],
    });

    expect(assetsValidateCommand).toHaveBeenCalledWith(
      expect.any(Object),
      [],
      expect.objectContaining({ agent: "poe" }),
    );
  });
});
