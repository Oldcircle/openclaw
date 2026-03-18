import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runRegisteredCli } from "../test-utils/command-runner.js";

const contextBookUseCommand = vi.fn().mockResolvedValue(undefined);

vi.mock("../commands/context-book.js", () => ({
  contextBookUseCommand,
}));

describe("context-book cli", () => {
  let registerContextBookCli: (typeof import("./context-book-cli.js"))["registerContextBookCli"];

  beforeAll(async () => {
    ({ registerContextBookCli } = await import("./context-book-cli.js"));
  });

  beforeEach(() => {
    contextBookUseCommand.mockClear();
  });

  it("passes the selected context book to the command", async () => {
    await runRegisteredCli({
      register: registerContextBookCli as (program: Command) => void,
      argv: ["context-book", "use", "coding-knowledge"],
    });

    expect(contextBookUseCommand).toHaveBeenCalledWith(
      "coding-knowledge",
      expect.any(Object),
      expect.objectContaining({ agent: undefined }),
    );
  });

  it("passes --agent through to context-book use", async () => {
    await runRegisteredCli({
      register: registerContextBookCli as (program: Command) => void,
      argv: ["context-book", "--agent", "poe", "use", "coding-knowledge"],
    });

    expect(contextBookUseCommand).toHaveBeenCalledWith(
      "coding-knowledge",
      expect.any(Object),
      expect.objectContaining({ agent: "poe" }),
    );
  });
});
