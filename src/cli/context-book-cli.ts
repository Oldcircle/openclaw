import type { Command } from "commander";
import { contextBookUseCommand } from "../commands/context-book.js";
import { defaultRuntime } from "../runtime.js";
import { resolveOptionFromCommand, runCommandWithRuntime } from "./cli-utils.js";

function runContextBookCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerContextBookCli(program: Command) {
  const contextBook = program
    .command("context-book")
    .description("Manage workspace Context Book defaults")
    .option("--agent <id>", "Agent id whose workspace Agent Card should be updated");

  contextBook
    .command("use")
    .description("Set the default Context Book in the workspace Agent Card")
    .argument("<name>", "Context Book file name or basename")
    .action(async (name: string, _opts, command) => {
      const agent = resolveOptionFromCommand<string>(command, "agent");
      await runContextBookCommand(async () => {
        await contextBookUseCommand(name, defaultRuntime, { agent });
      });
    });
}
