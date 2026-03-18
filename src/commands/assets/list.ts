import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { type AssetInfo, type AssetType, listWorkspaceAssets } from "../../agents/assets.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import { shortenHomePath } from "../../utils.js";
import { getTerminalTableWidth, renderTable } from "../../terminal/table.js";
import { loadValidConfigOrThrow, resolveKnownAgentId } from "../models/shared.js";

export type AssetsListOptions = {
  agent?: string;
  type?: string;
  json?: boolean;
  config?: OpenClawConfig;
};

const TYPE_LABELS: Record<AssetType, string> = {
  "agent-card": "Agent Card",
  "context-book": "Context Book",
  "prompt-profile": "Prompt Profile",
};

export async function assetsListCommand(
  runtime: RuntimeEnv,
  options: AssetsListOptions = {},
) {
  const cfg = options.config ?? (await loadValidConfigOrThrow());
  const agentId =
    resolveKnownAgentId({ cfg, rawAgentId: options.agent }) ?? resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  const validTypes = new Set<AssetType>(["agent-card", "context-book", "prompt-profile"]);
  let filterType: AssetType | undefined;
  if (options.type) {
    if (!validTypes.has(options.type as AssetType)) {
      throw new Error(
        `Invalid type "${options.type}". Valid types: ${[...validTypes].join(", ")}`,
      );
    }
    filterType = options.type as AssetType;
  }

  const assets = await listWorkspaceAssets({ workspaceDir, type: filterType });

  if (options.json) {
    runtime.log(JSON.stringify(assets, null, 2));
    return;
  }

  if (assets.length === 0) {
    runtime.log(`No assets found in workspace for agent ${agentId}.`);
    runtime.log(`  workspace: ${shortenHomePath(workspaceDir)}`);
    return;
  }

  runtime.log(`Assets for agent ${agentId} (${shortenHomePath(workspaceDir)}):\n`);

  const tableWidth = getTerminalTableWidth();
  const rows = assets.map((asset) => ({
    Type: TYPE_LABELS[asset.type] ?? asset.type,
    Name: asset.name,
    File: asset.fileName,
    Default: asset.isDefault ? "*" : "",
  }));

  runtime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Type", header: "Type", minWidth: 14 },
        { key: "Name", header: "Name", minWidth: 10, flex: true },
        { key: "File", header: "File", minWidth: 12, flex: true },
        { key: "Default", header: "Default", minWidth: 7 },
      ],
      rows,
    }).trimEnd(),
  );

  runtime.log("");
  runtime.log(`Total: ${assets.length} asset(s)`);
}
