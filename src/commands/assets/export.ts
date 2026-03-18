import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { listWorkspaceAssets } from "../../agents/assets.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import { shortenHomePath } from "../../utils.js";
import { loadValidConfigOrThrow, resolveKnownAgentId } from "../models/shared.js";

export type AssetsExportOptions = {
  agent?: string;
  output?: string;
  config?: OpenClawConfig;
};

export async function assetsExportCommand(
  name: string,
  runtime: RuntimeEnv,
  options: AssetsExportOptions = {},
) {
  const cfg = options.config ?? (await loadValidConfigOrThrow());
  const agentId =
    resolveKnownAgentId({ cfg, rawAgentId: options.agent }) ?? resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  const allAssets = await listWorkspaceAssets({ workspaceDir });
  const match = allAssets.find(
    (a) => a.name === name || a.fileName === name || path.basename(a.fileName, path.extname(a.fileName)) === name,
  );
  if (!match) {
    throw new Error(
      `Asset "${name}" not found. Use "openclaw assets list" to see available assets.`,
    );
  }

  const rawContent = await fs.readFile(match.filePath, "utf-8");
  const ext = path.extname(match.filePath).toLowerCase();

  const meta = {
    type: match.type,
    version: "1.0",
    exportedAt: new Date().toISOString(),
    sourceAgent: agentId,
  };

  let exported: string;
  if (ext === ".json") {
    const parsed = JSON.parse(rawContent);
    const withMeta = { _meta: meta, ...parsed };
    exported = JSON.stringify(withMeta, null, 2) + "\n";
  } else {
    const parsed = YAML.parse(rawContent);
    const withMeta = { _meta: meta, ...(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : { entries: parsed }) };
    exported = YAML.stringify(withMeta, { lineWidth: 0 });
  }

  const defaultFileName = `${match.name}.${match.type}${ext}`;
  const outputPath = options.output ?? path.resolve(defaultFileName);

  await fs.writeFile(outputPath, exported, "utf-8");
  runtime.log(`Exported ${match.type} "${match.name}" -> ${shortenHomePath(outputPath)}`);
}
