import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { type AssetType, validateWorkspaceAssets } from "../../agents/assets.js";
import { CONTEXT_BOOKS_DIRNAME } from "../../agents/context-books.js";
import { DEFAULT_PROMPT_PROFILES_DIRNAME } from "../../agents/prompt-profiles.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import { shortenHomePath } from "../../utils.js";
import { loadValidConfigOrThrow, resolveKnownAgentId } from "../models/shared.js";

export type AssetsImportOptions = {
  agent?: string;
  force?: boolean;
  config?: OpenClawConfig;
};

const AGENT_CARD_FILENAMES = ["agent-card.yaml", "agent-card.yml", "agent-card.json"] as const;

export async function assetsImportCommand(
  file: string,
  runtime: RuntimeEnv,
  options: AssetsImportOptions = {},
) {
  const cfg = options.config ?? (await loadValidConfigOrThrow());
  const agentId =
    resolveKnownAgentId({ cfg, rawAgentId: options.agent }) ?? resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  const filePath = path.isAbsolute(file) ? file : path.resolve(file);
  let rawContent: string;
  try {
    rawContent = await fs.readFile(filePath, "utf-8");
  } catch {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  let parsed: unknown;
  try {
    parsed = ext === ".json" ? JSON.parse(rawContent) : YAML.parse(rawContent);
  } catch {
    throw new Error(`Invalid YAML/JSON: ${filePath}`);
  }

  const { type, cleanContent } = resolveImportType(parsed, filePath);

  const destPath = resolveDestinationPath(workspaceDir, type, filePath);

  try {
    await fs.access(destPath);
    if (!options.force) {
      throw new Error(
        `Asset already exists: ${shortenHomePath(destPath)}. Use --force to overwrite.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(destPath), { recursive: true });

  let output: string;
  if (ext === ".json") {
    output = JSON.stringify(cleanContent, null, 2) + "\n";
  } else {
    output = YAML.stringify(cleanContent, { lineWidth: 0 });
  }

  await fs.writeFile(destPath, output, "utf-8");

  const issues = await validateWorkspaceAssets({ workspaceDir, files: [destPath] });
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  runtime.log(`Imported ${type} -> ${shortenHomePath(destPath)}`);

  if (errors.length > 0) {
    runtime.log("");
    for (const issue of errors) {
      runtime.log(`ERROR: ${issue.message}`);
    }
    runtime.log(`\nImported with ${errors.length} error(s). Fix the issues above.`);
  } else if (warnings.length > 0) {
    for (const issue of warnings) {
      runtime.log(`WARN: ${issue.message}`);
    }
  }
}

function resolveImportType(
  parsed: unknown,
  filePath: string,
): { type: AssetType; cleanContent: unknown } {
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const doc = parsed as Record<string, unknown>;

    if (doc._meta && typeof doc._meta === "object" && !Array.isArray(doc._meta)) {
      const meta = doc._meta as Record<string, unknown>;
      const type = meta.type as string | undefined;
      const { _meta, ...rest } = doc;
      if (type === "agent-card" || type === "context-book" || type === "prompt-profile") {
        return { type, cleanContent: rest };
      }
    }

    if (doc.identity !== undefined || doc.personality !== undefined || doc.depth_prompt !== undefined) {
      return { type: "agent-card", cleanContent: doc };
    }

    if (doc.entries !== undefined) {
      return { type: "context-book", cleanContent: doc };
    }

    if (doc.modules !== undefined || doc.temperature !== undefined || doc.tools !== undefined) {
      return { type: "prompt-profile", cleanContent: doc };
    }
  }

  if (Array.isArray(parsed)) {
    return { type: "context-book", cleanContent: parsed };
  }

  const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (baseName.includes("agent-card")) {
    return { type: "agent-card", cleanContent: parsed };
  }
  if (baseName.includes("profile") || baseName.includes("preset")) {
    return { type: "prompt-profile", cleanContent: parsed };
  }

  return { type: "context-book", cleanContent: parsed };
}

function resolveDestinationPath(
  workspaceDir: string,
  type: AssetType,
  sourcePath: string,
): string {
  const fileName = path.basename(sourcePath);
  const cleanFileName = fileName
    .replace(/\.agent-card\./g, ".")
    .replace(/\.context-book\./g, ".")
    .replace(/\.prompt-profile\./g, ".");

  switch (type) {
    case "agent-card": {
      const ext = path.extname(cleanFileName).toLowerCase();
      const targetName = ext === ".json" ? "agent-card.json" : "agent-card.yaml";
      return path.join(workspaceDir, targetName);
    }
    case "context-book":
      return path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME, cleanFileName);
    case "prompt-profile":
      return path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME, cleanFileName);
  }
}
