import type { Command } from "commander";
import { assetsListCommand, assetsValidateCommand } from "../commands/assets.js";
import { defaultRuntime } from "../runtime.js";
import { resolveOptionFromCommand, runCommandWithRuntime } from "./cli-utils.js";

function runAssetsCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerAssetsCli(program: Command) {
  const assets = program
    .command("assets")
    .description("List and validate workspace assets (Agent Card, Context Book, Prompt Profile)")
    .option("--agent <id>", "Agent id whose workspace to inspect");

  assets
    .command("list")
    .description("List all assets in the workspace")
    .option("--type <type>", "Filter by type: agent-card, context-book, prompt-profile")
    .option("--json", "Output JSON", false)
    .action(async (opts, command) => {
      const agent = resolveOptionFromCommand<string>(command, "agent");
      await runAssetsCommand(async () => {
        await assetsListCommand(defaultRuntime, { agent, type: opts.type, json: opts.json });
      });
    });

  assets
    .command("validate")
    .description("Validate asset files for schema correctness")
    .argument("[files...]", "Specific files to validate (default: all workspace assets)")
    .option("--json", "Output JSON", false)
    .action(async (files: string[], opts, command) => {
      const agent = resolveOptionFromCommand<string>(command, "agent");
      await runAssetsCommand(async () => {
        await assetsValidateCommand(defaultRuntime, files, { agent, json: opts.json });
      });
    });
}
