import type { Dirent } from "node:fs";
import syncFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { resolveUserPath } from "../utils.js";
import { CONTEXT_BOOKS_DIRNAME } from "./context-books.js";
import { DEFAULT_PROMPT_PROFILES_DIRNAME } from "./prompt-profiles.js";

const AGENT_CARD_FILENAMES = ["agent-card.yaml", "agent-card.yml", "agent-card.json"] as const;
const ASSET_EXTENSIONS = new Set([".json", ".yaml", ".yml"]);
const MAX_FILE_BYTES = 512 * 1024;

export type AssetType = "agent-card" | "context-book" | "prompt-profile";

export type AssetInfo = {
  type: AssetType;
  name: string;
  fileName: string;
  filePath: string;
  isDefault: boolean;
};

export type AssetValidationIssue = {
  type: AssetType;
  fileName: string;
  filePath: string;
  level: "error" | "warning";
  message: string;
};

type AgentCardDefaults = {
  defaultContextBook?: string;
  defaultPromptProfile?: string;
};

function readAssetFileSync(filePath: string): string | null {
  try {
    const stat = syncFs.statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      return null;
    }
    return syncFs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function parseYamlOrJson(
  raw: string,
  filePath: string,
): Record<string, unknown> | unknown[] | null {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".json") {
      return JSON.parse(raw);
    }
    return YAML.parse(raw);
  } catch {
    return null;
  }
}

async function resolveAgentCardDefaults(workspaceDir: string): Promise<AgentCardDefaults> {
  for (const fileName of AGENT_CARD_FILENAMES) {
    const filePath = path.join(workspaceDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      continue;
    }
    const raw = readAssetFileSync(filePath);
    if (!raw) {
      return {};
    }
    const parsed = parseYamlOrJson(raw, filePath);
    if (!parsed || Array.isArray(parsed)) {
      return {};
    }
    return {
      defaultContextBook:
        typeof parsed.default_context_book === "string" ? parsed.default_context_book : undefined,
      defaultPromptProfile:
        typeof parsed.default_prompt_profile === "string"
          ? parsed.default_prompt_profile
          : undefined,
    };
  }
  return {};
}

function matchesSelection(fileName: string, selection: string): boolean {
  if (fileName === selection) {
    return true;
  }
  const baseName = path.basename(fileName, path.extname(fileName));
  return baseName === selection;
}

async function listDirAssets(dir: string): Promise<Array<{ fileName: string; filePath: string }>> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    return [];
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ASSET_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .toSorted((a, b) => a.localeCompare(b))
    .map((name) => ({ fileName: name, filePath: path.join(dir, name) }));
}

export async function listWorkspaceAssets(params: {
  workspaceDir: string;
  type?: AssetType;
}): Promise<AssetInfo[]> {
  const workspaceDir = resolveUserPath(params.workspaceDir);
  const defaults = await resolveAgentCardDefaults(workspaceDir);
  const assets: AssetInfo[] = [];

  if (!params.type || params.type === "agent-card") {
    for (const fileName of AGENT_CARD_FILENAMES) {
      const filePath = path.join(workspaceDir, fileName);
      try {
        await fs.access(filePath);
      } catch {
        continue;
      }
      const raw = readAssetFileSync(filePath);
      if (!raw) {
        continue;
      }
      const parsed = parseYamlOrJson(raw, filePath);
      if (!parsed || Array.isArray(parsed)) {
        continue;
      }
      const name =
        typeof parsed.name === "string"
          ? parsed.name
          : path.basename(fileName, path.extname(fileName));
      assets.push({
        type: "agent-card",
        name,
        fileName,
        filePath,
        isDefault: true,
      });
      break;
    }
  }

  if (!params.type || params.type === "context-book") {
    const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
    const files = await listDirAssets(contextBooksDir);
    for (const file of files) {
      const baseName = path.basename(file.fileName, path.extname(file.fileName));
      const isDefault = defaults.defaultContextBook
        ? matchesSelection(file.fileName, defaults.defaultContextBook)
        : false;
      assets.push({
        type: "context-book",
        name: baseName,
        fileName: file.fileName,
        filePath: file.filePath,
        isDefault,
      });
    }
  }

  if (!params.type || params.type === "prompt-profile") {
    const profilesDir = path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME);
    const files = await listDirAssets(profilesDir);
    for (const file of files) {
      const baseName = path.basename(file.fileName, path.extname(file.fileName));
      const isDefault = defaults.defaultPromptProfile
        ? matchesSelection(file.fileName, defaults.defaultPromptProfile)
        : false;
      assets.push({
        type: "prompt-profile",
        name: baseName,
        fileName: file.fileName,
        filePath: file.filePath,
        isDefault,
      });
    }
  }

  return assets;
}

async function discoverAllAssetFiles(workspaceDir: string): Promise<string[]> {
  const filePaths: string[] = [];

  // Agent cards
  for (const fileName of AGENT_CARD_FILENAMES) {
    const filePath = path.join(workspaceDir, fileName);
    try {
      await fs.access(filePath);
      filePaths.push(filePath);
      break;
    } catch {
      continue;
    }
  }

  // Context books
  const cbFiles = await listDirAssets(path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME));
  filePaths.push(...cbFiles.map((f) => f.filePath));

  // Prompt profiles
  const ppFiles = await listDirAssets(path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME));
  filePaths.push(...ppFiles.map((f) => f.filePath));

  return filePaths;
}

export async function validateWorkspaceAssets(params: {
  workspaceDir: string;
  files?: string[];
}): Promise<AssetValidationIssue[]> {
  const workspaceDir = resolveUserPath(params.workspaceDir);
  const issues: AssetValidationIssue[] = [];

  if (params.files && params.files.length > 0) {
    for (const file of params.files) {
      const filePath = path.isAbsolute(file) ? file : path.resolve(file);
      issues.push(...(await validateSingleAsset(filePath)));
    }
    return issues;
  }

  const allFiles = await discoverAllAssetFiles(workspaceDir);
  for (const filePath of allFiles) {
    issues.push(...(await validateSingleAsset(filePath)));
  }

  return issues;
}

async function validateSingleAsset(filePath: string): Promise<AssetValidationIssue[]> {
  const issues: AssetValidationIssue[] = [];
  const fileName = path.basename(filePath);
  const type = inferAssetType(filePath);

  const raw = readAssetFileSync(filePath);
  if (!raw) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "file cannot be read or exceeds size limit",
    });
    return issues;
  }

  if (!raw.trim()) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "file is empty",
    });
    return issues;
  }

  const parsed = parseYamlOrJson(raw, filePath);
  if (parsed === null) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "invalid YAML/JSON syntax",
    });
    return issues;
  }

  switch (type) {
    case "agent-card":
      issues.push(...validateAgentCard(parsed, fileName, filePath));
      break;
    case "context-book":
      issues.push(...validateContextBook(parsed, fileName, filePath));
      break;
    case "prompt-profile":
      issues.push(...validatePromptProfile(parsed, fileName, filePath));
      break;
  }

  return issues;
}

function inferAssetType(filePath: string): AssetType {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes(`/${CONTEXT_BOOKS_DIRNAME}/`)) {
    return "context-book";
  }
  if (normalized.includes(`/${DEFAULT_PROMPT_PROFILES_DIRNAME}/`)) {
    return "prompt-profile";
  }
  const baseName = path.basename(filePath, path.extname(filePath));
  if (baseName === "agent-card") {
    return "agent-card";
  }
  return "context-book";
}

function validateAgentCard(
  parsed: unknown,
  fileName: string,
  filePath: string,
): AssetValidationIssue[] {
  const issues: AssetValidationIssue[] = [];
  const type: AssetType = "agent-card";

  if (Array.isArray(parsed)) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "agent card must be an object, not an array",
    });
    return issues;
  }
  if (typeof parsed !== "object" || parsed === null) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "agent card must be an object",
    });
    return issues;
  }

  const card = parsed as Record<string, unknown>;
  if (card.identity !== undefined && typeof card.identity !== "string") {
    issues.push({ type, fileName, filePath, level: "error", message: "identity must be a string" });
  }
  if (card.personality !== undefined && typeof card.personality !== "string") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "personality must be a string",
    });
  }
  if (card.tone !== undefined && typeof card.tone !== "string") {
    issues.push({ type, fileName, filePath, level: "error", message: "tone must be a string" });
  }
  if (card.user_relationship !== undefined && typeof card.user_relationship !== "string") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "user_relationship must be a string",
    });
  }
  if (card.behavior_notes !== undefined && !Array.isArray(card.behavior_notes)) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "behavior_notes must be an array",
    });
  }
  if (card.default_context_book !== undefined && typeof card.default_context_book !== "string") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "default_context_book must be a string",
    });
  }
  if (
    card.default_prompt_profile !== undefined &&
    typeof card.default_prompt_profile !== "string"
  ) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "default_prompt_profile must be a string",
    });
  }
  if (card.depth_prompt !== undefined) {
    if (
      typeof card.depth_prompt !== "object" ||
      card.depth_prompt === null ||
      Array.isArray(card.depth_prompt)
    ) {
      issues.push({
        type,
        fileName,
        filePath,
        level: "error",
        message: "depth_prompt must be an object",
      });
    } else {
      const dp = card.depth_prompt as Record<string, unknown>;
      if (dp.content !== undefined && typeof dp.content !== "string") {
        issues.push({
          type,
          fileName,
          filePath,
          level: "error",
          message: "depth_prompt.content must be a string",
        });
      }
      if (dp.depth !== undefined && (typeof dp.depth !== "number" || !Number.isFinite(dp.depth))) {
        issues.push({
          type,
          fileName,
          filePath,
          level: "error",
          message: "depth_prompt.depth must be a number",
        });
      }
    }
  }

  const knownFields = new Set([
    "name",
    "version",
    "identity",
    "personality",
    "tone",
    "user_relationship",
    "behavior_notes",
    "example_dialogues",
    "default_context_book",
    "default_prompt_profile",
    "depth_prompt",
  ]);
  for (const key of Object.keys(card)) {
    if (!knownFields.has(key)) {
      issues.push({ type, fileName, filePath, level: "warning", message: `unknown field: ${key}` });
    }
  }

  return issues;
}

function validateContextBookEntry(
  entry: unknown,
  index: number,
  fileName: string,
  filePath: string,
): AssetValidationIssue[] {
  const issues: AssetValidationIssue[] = [];
  const type: AssetType = "context-book";

  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1} must be an object`,
    });
    return issues;
  }

  const e = entry as Record<string, unknown>;
  if (!e.content || typeof e.content !== "string") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: content is required and must be a string`,
    });
  }
  if (e.name !== undefined && typeof e.name !== "string") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: name must be a string`,
    });
  }
  if (e.enabled !== undefined && typeof e.enabled !== "boolean") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: enabled must be a boolean`,
    });
  }
  if (e.alwaysActive !== undefined && typeof e.alwaysActive !== "boolean") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: alwaysActive must be a boolean`,
    });
  }
  if (e.keywords !== undefined && !Array.isArray(e.keywords)) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: keywords must be an array`,
    });
  }
  if (e.position !== undefined && typeof e.position !== "string") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: position must be a string`,
    });
  }
  if (e.position !== undefined && typeof e.position === "string") {
    const valid = new Set(["before_context", "after_context", "tail_reminder", "at_depth"]);
    if (!valid.has(e.position)) {
      issues.push({
        type,
        fileName,
        filePath,
        level: "warning",
        message: `entry #${index + 1}: unknown position "${e.position}"`,
      });
    }
  }
  if (e.order !== undefined && (typeof e.order !== "number" || !Number.isFinite(e.order))) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: order must be a number`,
    });
  }
  if (e.depth !== undefined && (typeof e.depth !== "number" || !Number.isFinite(e.depth))) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: depth must be a number`,
    });
  }
  if (
    e.scanDepth !== undefined &&
    (typeof e.scanDepth !== "number" || !Number.isFinite(e.scanDepth))
  ) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: scanDepth must be a number`,
    });
  }
  if (
    e.tokenBudget !== undefined &&
    (typeof e.tokenBudget !== "number" || !Number.isFinite(e.tokenBudget))
  ) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: tokenBudget must be a number`,
    });
  }
  if (e.sticky !== undefined && (typeof e.sticky !== "number" || !Number.isFinite(e.sticky))) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: sticky must be a number`,
    });
  }
  if (e.delay !== undefined && (typeof e.delay !== "number" || !Number.isFinite(e.delay))) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: delay must be a number`,
    });
  }

  // Experience asset fields
  if (e.source !== undefined && e.source !== "manual" && e.source !== "auto") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: source must be "manual" or "auto"`,
    });
  }
  if (e.confidence !== undefined && typeof e.confidence === "string") {
    const validConfidence = new Set(["low", "medium", "high", "proven", "deprecated"]);
    if (!validConfidence.has(e.confidence)) {
      issues.push({
        type,
        fileName,
        filePath,
        level: "warning",
        message: `entry #${index + 1}: unknown confidence "${e.confidence}"`,
      });
    }
  }
  if (
    e.hitCount !== undefined &&
    (typeof e.hitCount !== "number" || !Number.isFinite(e.hitCount))
  ) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: hitCount must be a number`,
    });
  }
  if (e.lastHitAt !== undefined && typeof e.lastHitAt !== "string") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: lastHitAt must be a string`,
    });
  }
  if (e.sourceSession !== undefined && typeof e.sourceSession !== "string") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: sourceSession must be a string`,
    });
  }
  if (e.situation !== undefined && typeof e.situation !== "string") {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: `entry #${index + 1}: situation must be a string`,
    });
  }

  return issues;
}

function validateContextBook(
  parsed: unknown,
  fileName: string,
  filePath: string,
): AssetValidationIssue[] {
  const issues: AssetValidationIssue[] = [];
  const type: AssetType = "context-book";

  let rawEntries: unknown[];
  if (Array.isArray(parsed)) {
    rawEntries = parsed;
  } else if (typeof parsed === "object" && parsed !== null) {
    const doc = parsed as Record<string, unknown>;
    if (Array.isArray(doc.entries)) {
      rawEntries = doc.entries;
    } else if (doc.entries !== undefined) {
      issues.push({
        type,
        fileName,
        filePath,
        level: "error",
        message: "entries must be an array",
      });
      return issues;
    } else {
      issues.push({
        type,
        fileName,
        filePath,
        level: "error",
        message: "context book must be an array or have an entries array",
      });
      return issues;
    }
  } else {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "context book must be an array or object",
    });
    return issues;
  }

  if (rawEntries.length === 0) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "warning",
      message: "context book has no entries",
    });
  }

  for (const [index, entry] of rawEntries.entries()) {
    issues.push(...validateContextBookEntry(entry, index, fileName, filePath));
  }

  return issues;
}

function validatePromptProfile(
  parsed: unknown,
  fileName: string,
  filePath: string,
): AssetValidationIssue[] {
  const issues: AssetValidationIssue[] = [];
  const type: AssetType = "prompt-profile";

  if (Array.isArray(parsed)) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "prompt profile must be an object, not an array",
    });
    return issues;
  }
  if (typeof parsed !== "object" || parsed === null) {
    issues.push({
      type,
      fileName,
      filePath,
      level: "error",
      message: "prompt profile must be an object",
    });
    return issues;
  }

  const profile = parsed as Record<string, unknown>;

  if (profile.temperature !== undefined) {
    if (typeof profile.temperature !== "number" || !Number.isFinite(profile.temperature)) {
      issues.push({
        type,
        fileName,
        filePath,
        level: "error",
        message: "temperature must be a number",
      });
    } else if (profile.temperature < 0 || profile.temperature > 2) {
      issues.push({
        type,
        fileName,
        filePath,
        level: "warning",
        message: "temperature is usually between 0 and 2",
      });
    }
  }

  if (profile.max_tokens !== undefined && profile.max_tokens !== null) {
    if (
      typeof profile.max_tokens !== "number" ||
      !Number.isFinite(profile.max_tokens) ||
      profile.max_tokens < 1
    ) {
      issues.push({
        type,
        fileName,
        filePath,
        level: "error",
        message: "max_tokens must be a positive number",
      });
    }
  }

  if (profile.modules !== undefined) {
    if (!Array.isArray(profile.modules)) {
      issues.push({
        type,
        fileName,
        filePath,
        level: "error",
        message: "modules must be an array",
      });
    } else {
      for (const [index, mod] of profile.modules.entries()) {
        if (typeof mod !== "object" || mod === null || Array.isArray(mod)) {
          issues.push({
            type,
            fileName,
            filePath,
            level: "error",
            message: `module #${index + 1} must be an object`,
          });
          continue;
        }
        const m = mod as Record<string, unknown>;
        if (!m.content || typeof m.content !== "string") {
          issues.push({
            type,
            fileName,
            filePath,
            level: "error",
            message: `module #${index + 1}: content is required and must be a string`,
          });
        }
        if (m.enabled !== undefined && typeof m.enabled !== "boolean") {
          issues.push({
            type,
            fileName,
            filePath,
            level: "error",
            message: `module #${index + 1}: enabled must be a boolean`,
          });
        }
      }
    }
  }

  if (profile.tools !== undefined) {
    if (
      typeof profile.tools !== "object" ||
      profile.tools === null ||
      Array.isArray(profile.tools)
    ) {
      issues.push({ type, fileName, filePath, level: "error", message: "tools must be an object" });
    } else {
      const tools = profile.tools as Record<string, unknown>;
      if (tools.allow !== undefined && !Array.isArray(tools.allow)) {
        issues.push({
          type,
          fileName,
          filePath,
          level: "error",
          message: "tools.allow must be an array",
        });
      }
      if (tools.deny !== undefined && !Array.isArray(tools.deny)) {
        issues.push({
          type,
          fileName,
          filePath,
          level: "error",
          message: "tools.deny must be an array",
        });
      }
      if (tools.allow !== undefined && tools.deny !== undefined) {
        issues.push({
          type,
          fileName,
          filePath,
          level: "warning",
          message: "tools has both allow and deny; allow takes precedence",
        });
      }
    }
  }

  if (profile.output !== undefined) {
    if (
      typeof profile.output !== "object" ||
      profile.output === null ||
      Array.isArray(profile.output)
    ) {
      issues.push({
        type,
        fileName,
        filePath,
        level: "error",
        message: "output must be an object",
      });
    }
  }

  return issues;
}
