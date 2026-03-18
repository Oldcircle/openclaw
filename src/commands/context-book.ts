import { setAgentCardDefaultContextBook } from "../agents/agent-card.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveContextBookSelection } from "../agents/context-books.js";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { shortenHomePath } from "../utils.js";
import { loadValidConfigOrThrow, resolveKnownAgentId } from "./models/shared.js";

export type ContextBookUseOptions = {
  agent?: string;
  config?: OpenClawConfig;
};

export async function contextBookUseCommand(
  contextBookRaw: string,
  runtime: RuntimeEnv,
  options: ContextBookUseOptions = {},
) {
  const cfg = options.config ?? (await loadValidConfigOrThrow());
  const agentId =
    resolveKnownAgentId({ cfg, rawAgentId: options.agent }) ?? resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  const warnings: string[] = [];
  const selection = await resolveContextBookSelection({
    workspaceDir,
    selectedContextBook: contextBookRaw,
    warn: (message) => warnings.push(message),
  });
  if (!selection) {
    throw new Error(warnings.at(-1) ?? `Context book "${contextBookRaw}" not found.`);
  }

  const updated = await setAgentCardDefaultContextBook({
    workspaceDir,
    defaultContextBook: selection.selectedContextBook,
  });

  runtime.log(
    `Agent ${agentId}: default context book -> ${updated.defaultContextBook}${selection.contextBookName !== updated.defaultContextBook ? ` (${selection.contextBookName})` : ""}`,
  );
  runtime.log(`Agent card: ${shortenHomePath(updated.sourcePath)}`);
}
