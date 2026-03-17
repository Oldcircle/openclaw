import type { Command } from "commander";
import { profileUseCommand } from "../commands/profile.js";
import { defaultRuntime } from "../runtime.js";
import { resolveOptionFromCommand, runCommandWithRuntime } from "./cli-utils.js";

function runProfileCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerProfileCli(program: Command) {
  const profile = program
    .command("profile")
    .description("Manage workspace Prompt Profile defaults")
    .option("--agent <id>", "Agent id whose workspace Agent Card should be updated");

  profile
    .command("use")
    .description("Set the default Prompt Profile in the workspace Agent Card")
    .argument("<name>", "Prompt Profile file name or basename")
    .action(async (name: string, _opts, command) => {
      const agent = resolveOptionFromCommand<string>(command, "agent");
      await runProfileCommand(async () => {
        await profileUseCommand(name, defaultRuntime, { agent });
      });
    });
}
