import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { type AssetValidationIssue, validateWorkspaceAssets } from "../../agents/assets.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import { shortenHomePath } from "../../utils.js";
import { loadValidConfigOrThrow, resolveKnownAgentId } from "../models/shared.js";

export type AssetsValidateOptions = {
  agent?: string;
  json?: boolean;
  config?: OpenClawConfig;
};

export async function assetsValidateCommand(
  runtime: RuntimeEnv,
  files: string[],
  options: AssetsValidateOptions = {},
) {
  const cfg = options.config ?? (await loadValidConfigOrThrow());
  const agentId =
    resolveKnownAgentId({ cfg, rawAgentId: options.agent }) ?? resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  const issues = await validateWorkspaceAssets({
    workspaceDir,
    files: files.length > 0 ? files : undefined,
  });

  if (options.json) {
    runtime.log(JSON.stringify(issues, null, 2));
    return;
  }

  if (issues.length === 0) {
    const target = files.length > 0 ? `${files.length} file(s)` : `all assets`;
    runtime.log(`Validated ${target} for agent ${agentId} — no issues found.`);
    return;
  }

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  for (const issue of issues) {
    const prefix = issue.level === "error" ? "ERROR" : "WARN";
    runtime.log(`${prefix}: ${shortenHomePath(issue.filePath)}: ${issue.message}`);
  }

  runtime.log("");
  runtime.log(
    `${errors.length} error(s), ${warnings.length} warning(s)`,
  );

  if (errors.length > 0) {
    runtime.exit(1);
  }
}
