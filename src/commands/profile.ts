import { setAgentCardDefaultPromptProfile } from "../agents/agent-card.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolvePromptProfileSelection } from "../agents/prompt-profiles.js";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { shortenHomePath } from "../utils.js";
import { loadValidConfigOrThrow, resolveKnownAgentId } from "./models/shared.js";

export type ProfileUseOptions = {
  agent?: string;
  config?: OpenClawConfig;
};

export async function profileUseCommand(
  profileRaw: string,
  runtime: RuntimeEnv,
  options: ProfileUseOptions = {},
) {
  const cfg = options.config ?? (await loadValidConfigOrThrow());
  const agentId =
    resolveKnownAgentId({ cfg, rawAgentId: options.agent }) ?? resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  const warnings: string[] = [];
  const selection = await resolvePromptProfileSelection({
    workspaceDir,
    selectedPromptProfile: profileRaw,
    warn: (message) => warnings.push(message),
  });
  if (!selection) {
    throw new Error(warnings.at(-1) ?? `Prompt profile "${profileRaw}" not found.`);
  }

  const updated = await setAgentCardDefaultPromptProfile({
    workspaceDir,
    defaultPromptProfile: selection.selectedPromptProfile,
  });

  runtime.log(
    `Agent ${agentId}: default prompt profile -> ${updated.defaultPromptProfile}${selection.profileName !== updated.defaultPromptProfile ? ` (${selection.profileName})` : ""}`,
  );
  runtime.log(`Agent card: ${shortenHomePath(updated.sourcePath)}`);
}
