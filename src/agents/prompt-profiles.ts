import type { Dirent } from "node:fs";
import syncFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { AgentStreamParams } from "../commands/agent/types.js";
import { openBoundaryFile } from "../infra/boundary-file-read.js";
import { joinPresentTextSegments } from "../shared/text/join-segments.js";
import { resolveUserPath } from "../utils.js";
import type { ReplyTagsMode } from "../utils/directive-tags.js";
import { normalizeToolList } from "./tool-policy.js";

export const DEFAULT_PROMPT_PROFILES_DIRNAME = "prompt-profiles";

const PROMPT_PROFILE_EXTENSIONS = new Set([".json", ".yaml", ".yml"]);
const PROMPT_PROFILE_MAX_FILE_BYTES = 256 * 1024;

type PromptProfilePosition = "before_context" | "after_context" | "tail_reminder" | "at_depth";

type RawPromptProfileDocument =
  | {
      name?: unknown;
      temperature?: unknown;
      max_tokens?: unknown;
      maxTokens?: unknown;
      modules?: unknown;
      tools?: unknown;
    }
  | unknown[];

type NormalizedPromptProfileModule = {
  name: string;
  content: string;
  position: PromptProfilePosition;
  depth: number;
  order: number;
  sourceIndex: number;
};

type LoadedPromptProfile = {
  profileName: string;
  sourcePath: string;
  modules: NormalizedPromptProfileModule[];
  streamParams: AgentStreamParams;
  toolPolicy?: {
    allow?: string[];
    deny?: string[];
  };
  preferredTools: string[];
  outputPreferences?: {
    format?: string;
    sections: string[];
    style: string[];
    rules: string[];
    requireFinalTag?: boolean;
    replyTags?: ReplyTagsMode;
  };
};

export type PromptProfilePromptContext = {
  profileName?: string;
  sourcePath?: string;
  prependSystemContext?: string;
  appendSystemContext?: string;
  streamParams?: AgentStreamParams;
  toolPolicy?: {
    allow?: string[];
    deny?: string[];
  };
  preferredTools: string[];
  outputPreferences?: {
    format?: string;
    sections: string[];
    style: string[];
    rules: string[];
    requireFinalTag?: boolean;
    replyTags?: ReplyTagsMode;
  };
  atDepthEntries: Array<{
    name: string;
    content: string;
    depth: number;
  }>;
  matchedModuleNames: string[];
  moduleEntries: Array<{
    name: string;
    position: PromptProfilePosition;
    depth: number;
    chars: number;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(parseString).filter(Boolean);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseReplyTagsMode(value: unknown): ReplyTagsMode | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) {
    return undefined;
  }
  if (normalized === "off" || normalized === "disabled" || normalized === "none") {
    return "off";
  }
  if (normalized === "current" || normalized === "current_only" || normalized === "current-only") {
    return "current_only";
  }
  if (
    normalized === "allow_explicit" ||
    normalized === "allow-explicit" ||
    normalized === "explicit"
  ) {
    return "allow_explicit";
  }
  return undefined;
}

function parseOrder(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}

function parseDepth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function parseTemperature(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseMaxTokens(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function parsePosition(value: unknown): PromptProfilePosition {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (trimmed === "before_context" || trimmed === "tail_reminder" || trimmed === "at_depth") {
    return trimmed;
  }
  return "after_context";
}

function buildSelectionCandidates(value: string): Set<string> {
  const trimmed = value.trim();
  if (!trimmed) {
    return new Set();
  }

  const candidates = new Set<string>();
  const normalized = trimmed.toLowerCase();
  const baseName = path.basename(trimmed).toLowerCase();
  candidates.add(normalized);
  candidates.add(baseName);
  candidates.add(path.basename(baseName, path.extname(baseName)));
  return candidates;
}

function matchesSelectedPromptProfile(fileName: string, selectedPromptProfile: string): boolean {
  const candidates = buildSelectionCandidates(selectedPromptProfile);
  if (candidates.size === 0) {
    return false;
  }

  const normalizedFileName = fileName.toLowerCase();
  const normalizedBaseName = path.basename(fileName, path.extname(fileName)).toLowerCase();
  return candidates.has(normalizedFileName) || candidates.has(normalizedBaseName);
}

async function readPromptProfileFile(params: {
  workspaceDir: string;
  filePath: string;
  warn?: (message: string) => void;
}): Promise<string | undefined> {
  const opened = await openBoundaryFile({
    absolutePath: params.filePath,
    rootPath: params.workspaceDir,
    boundaryLabel: "workspace root",
    maxBytes: PROMPT_PROFILE_MAX_FILE_BYTES,
  });
  if (!opened.ok) {
    params.warn?.(
      `skipping prompt profile ${params.filePath} - ${opened.reason === "validation" ? "invalid file" : opened.reason}`,
    );
    return undefined;
  }

  try {
    return syncFs.readFileSync(opened.fd, "utf-8");
  } catch {
    params.warn?.(`skipping prompt profile ${params.filePath} - failed to read file`);
    return undefined;
  } finally {
    syncFs.closeSync(opened.fd);
  }
}

function parsePromptProfileDocument(
  raw: string,
  sourcePath: string,
): RawPromptProfileDocument | null {
  const extension = path.extname(sourcePath).toLowerCase();
  try {
    const parsed =
      extension === ".json"
        ? (JSON.parse(raw) as unknown)
        : (YAML.parse(raw, { schema: "core" }) as unknown);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (isRecord(parsed)) {
      return parsed as RawPromptProfileDocument;
    }
    return null;
  } catch {
    return null;
  }
}

function resolvePromptProfileName(document: RawPromptProfileDocument, sourcePath: string): string {
  if (!Array.isArray(document) && isRecord(document)) {
    const configured = parseString(document.name);
    if (configured) {
      return configured;
    }
  }
  return path.basename(sourcePath, path.extname(sourcePath));
}

function resolvePromptProfileStreamParams(document: RawPromptProfileDocument): AgentStreamParams {
  if (Array.isArray(document) || !isRecord(document)) {
    return {};
  }

  const temperature = parseTemperature(document.temperature);
  const maxTokens = parseMaxTokens(document.max_tokens ?? document.maxTokens);
  return {
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}

function resolvePromptProfileToolConfig(document: RawPromptProfileDocument): {
  toolPolicy?: {
    allow?: string[];
    deny?: string[];
  };
  preferredTools: string[];
} {
  if (Array.isArray(document) || !isRecord(document)) {
    return { preferredTools: [] };
  }
  const tools = isRecord(document.tools) ? document.tools : null;
  if (!tools) {
    return { preferredTools: [] };
  }

  const allow = normalizeToolList(parseStringArray(tools.allow));
  const deny = normalizeToolList(parseStringArray(tools.deny));
  const preferredTools = normalizeToolList(
    parseStringArray(
      tools.prefer ?? tools.preferred ?? tools.preferred_tools ?? tools.preferredTools,
    ),
  );

  return {
    toolPolicy:
      allow.length > 0 || deny.length > 0
        ? {
            ...(allow.length > 0 ? { allow } : {}),
            ...(deny.length > 0 ? { deny } : {}),
          }
        : undefined,
    preferredTools,
  };
}

function resolvePromptProfileOutputPreferences(document: RawPromptProfileDocument): {
  outputPreferences?: {
    format?: string;
    sections: string[];
    style: string[];
    rules: string[];
    requireFinalTag?: boolean;
    replyTags?: ReplyTagsMode;
  };
} {
  if (Array.isArray(document) || !isRecord(document)) {
    return {};
  }
  const output = isRecord(document.output) ? document.output : null;
  if (!output) {
    return {};
  }

  const format = parseString(output.format) || undefined;
  const sections = parseStringArray(output.sections);
  const style = parseStringArray(output.style);
  const rules = parseStringArray(output.rules);
  const requireFinalTag = parseBoolean(output.require_final_tag ?? output.requireFinalTag, false);
  const replyTags = parseReplyTagsMode(output.reply_tags ?? output.replyTags);

  if (
    !format &&
    sections.length === 0 &&
    style.length === 0 &&
    rules.length === 0 &&
    !requireFinalTag &&
    !replyTags
  ) {
    return {};
  }

  return {
    outputPreferences: {
      format,
      sections,
      style,
      rules,
      ...(requireFinalTag ? { requireFinalTag: true } : {}),
      ...(replyTags ? { replyTags } : {}),
    },
  };
}

function normalizeModuleName(rawName: unknown, sourcePath: string, index: number): string {
  const trimmed = parseString(rawName);
  if (trimmed) {
    return trimmed;
  }
  return `${path.basename(sourcePath)}#${index + 1}`;
}

function normalizePromptProfileModules(
  document: RawPromptProfileDocument,
  sourcePath: string,
  warn?: (message: string) => void,
): NormalizedPromptProfileModule[] {
  const rawModules = Array.isArray(document)
    ? document
    : Array.isArray(document.modules)
      ? document.modules
      : [];
  const normalized: NormalizedPromptProfileModule[] = [];

  for (const [index, rawModule] of rawModules.entries()) {
    if (!isRecord(rawModule)) {
      warn?.(
        `skipping prompt profile module ${sourcePath}#${index + 1} - module must be an object`,
      );
      continue;
    }

    if (!parseBoolean(rawModule.enabled, true)) {
      continue;
    }

    const content = parseString(rawModule.content);
    if (!content) {
      warn?.(`skipping prompt profile module ${sourcePath}#${index + 1} - missing content`);
      continue;
    }

    normalized.push({
      name: normalizeModuleName(rawModule.name, sourcePath, index),
      content,
      position: parsePosition(rawModule.position),
      depth: parseDepth(rawModule.depth),
      order: parseOrder(rawModule.order),
      sourceIndex: index,
    });
  }

  normalized.sort((a, b) => {
    if (a.order !== b.order) {
      return b.order - a.order;
    }
    return a.sourceIndex - b.sourceIndex;
  });
  return normalized;
}

async function loadSelectedPromptProfile(params: {
  workspaceDir: string;
  defaultPromptProfile?: string;
  warn?: (message: string) => void;
}): Promise<LoadedPromptProfile | null> {
  const selectedPromptProfile = params.defaultPromptProfile?.trim();
  if (!selectedPromptProfile) {
    return null;
  }

  const workspaceDir = resolveUserPath(params.workspaceDir);
  const promptProfilesDir = path.join(workspaceDir, DEFAULT_PROMPT_PROFILES_DIRNAME);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(promptProfilesDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      params.warn?.(
        `default prompt profile "${selectedPromptProfile}" not found because ${promptProfilesDir} does not exist`,
      );
      return null;
    }
    params.warn?.(`failed to read prompt-profiles directory: ${promptProfilesDir}`);
    return null;
  }

  const fileName = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => PROMPT_PROFILE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .toSorted((a, b) => a.localeCompare(b))
    .find((candidate) => matchesSelectedPromptProfile(candidate, selectedPromptProfile));
  if (!fileName) {
    params.warn?.(
      `default prompt profile "${selectedPromptProfile}" not found in ${promptProfilesDir}`,
    );
    return null;
  }

  const sourcePath = path.join(promptProfilesDir, fileName);
  const raw = await readPromptProfileFile({
    workspaceDir,
    filePath: sourcePath,
    warn: params.warn,
  });
  if (!raw) {
    return null;
  }

  const parsed = parsePromptProfileDocument(raw, sourcePath);
  if (!parsed) {
    params.warn?.(`skipping prompt profile ${sourcePath} - invalid YAML/JSON document`);
    return null;
  }

  return {
    profileName: resolvePromptProfileName(parsed, sourcePath),
    sourcePath,
    modules: normalizePromptProfileModules(parsed, sourcePath, params.warn),
    streamParams: resolvePromptProfileStreamParams(parsed),
    ...resolvePromptProfileToolConfig(parsed),
    ...resolvePromptProfileOutputPreferences(parsed),
  };
}

function formatPromptProfileModule(params: {
  profileName: string;
  moduleName: string;
  content: string;
}): string {
  return [`[Prompt Profile: ${params.profileName} / ${params.moduleName}]`, params.content].join(
    "\n",
  );
}

function buildPromptProfileSection(params: {
  profileName: string;
  modules: NormalizedPromptProfileModule[];
  position: PromptProfilePosition;
}): string | undefined {
  const rendered = params.modules
    .filter((module) => module.position === params.position)
    .map((module) =>
      formatPromptProfileModule({
        profileName: params.profileName,
        moduleName: module.name,
        content: module.content,
      }),
    );
  if (rendered.length === 0) {
    return undefined;
  }
  return joinPresentTextSegments(rendered);
}

function buildPromptProfileToolPreferencesSection(params: {
  profileName: string;
  preferredTools: string[];
}): string | undefined {
  if (params.preferredTools.length === 0) {
    return undefined;
  }

  return [
    `[Prompt Profile: ${params.profileName} / Tool Preferences]`,
    `Prefer these tools or tool groups when relevant: ${params.preferredTools.join(", ")}`,
  ].join("\n");
}

function buildPromptProfileOutputPreferencesSection(params: {
  profileName: string;
  outputPreferences?: {
    format?: string;
    sections: string[];
    style: string[];
    rules: string[];
    requireFinalTag?: boolean;
    replyTags?: ReplyTagsMode;
  };
}): string | undefined {
  const preferences = params.outputPreferences;
  if (!preferences) {
    return undefined;
  }

  const replyTagsLabel =
    preferences.replyTags === "off"
      ? "disabled"
      : preferences.replyTags === "current_only"
        ? "current-only"
        : preferences.replyTags === "allow_explicit"
          ? "allow explicit ids when provided"
          : "";

  const lines = [
    `[Prompt Profile: ${params.profileName} / Output Preferences]`,
    preferences.format ? `Preferred output format: ${preferences.format}` : "",
    preferences.sections.length > 0 ? `Preferred sections: ${preferences.sections.join(", ")}` : "",
    preferences.style.length > 0 ? `Preferred style: ${preferences.style.join(", ")}` : "",
    preferences.requireFinalTag ? "Wrap the final user-visible answer in <final>...</final>." : "",
    replyTagsLabel ? `Reply tag policy: ${replyTagsLabel}` : "",
    preferences.rules.length > 0
      ? ["Output rules:", ...preferences.rules.map((rule) => `- ${rule}`)].join("\n")
      : "",
  ].filter(Boolean);

  return lines.length > 1 ? lines.join("\n") : undefined;
}

export async function resolvePromptProfilePromptContext(params: {
  workspaceDir: string;
  defaultPromptProfile?: string;
  warn?: (message: string) => void;
}): Promise<PromptProfilePromptContext> {
  const loaded = await loadSelectedPromptProfile(params);
  if (!loaded) {
    return {
      preferredTools: [],
      atDepthEntries: [],
      matchedModuleNames: [],
      moduleEntries: [],
    };
  }

  const prependSystemContext = buildPromptProfileSection({
    profileName: loaded.profileName,
    modules: loaded.modules,
    position: "before_context",
  });
  const appendSystemContext = joinPresentTextSegments(
    [
      buildPromptProfileSection({
        profileName: loaded.profileName,
        modules: loaded.modules,
        position: "after_context",
      }),
      buildPromptProfileSection({
        profileName: loaded.profileName,
        modules: loaded.modules,
        position: "tail_reminder",
      }),
      buildPromptProfileToolPreferencesSection({
        profileName: loaded.profileName,
        preferredTools: loaded.preferredTools,
      }),
      buildPromptProfileOutputPreferencesSection({
        profileName: loaded.profileName,
        outputPreferences: loaded.outputPreferences,
      }),
    ].filter(Boolean),
  );
  const atDepthEntries = loaded.modules
    .filter((module) => module.position === "at_depth")
    .map((module) => ({
      name: `${loaded.profileName} / ${module.name}`,
      content: formatPromptProfileModule({
        profileName: loaded.profileName,
        moduleName: module.name,
        content: module.content,
      }),
      depth: module.depth,
    }));

  return {
    profileName: loaded.profileName,
    sourcePath: loaded.sourcePath,
    prependSystemContext,
    appendSystemContext,
    streamParams: loaded.streamParams,
    toolPolicy: loaded.toolPolicy,
    preferredTools: loaded.preferredTools,
    outputPreferences: loaded.outputPreferences,
    atDepthEntries,
    matchedModuleNames: loaded.modules.map((module) => module.name),
    moduleEntries: loaded.modules.map((module) => ({
      name: module.name,
      position: module.position,
      depth: module.depth,
      chars: formatPromptProfileModule({
        profileName: loaded.profileName,
        moduleName: module.name,
        content: module.content,
      }).length,
    })),
  };
}

export function mergePromptProfileStreamParams(params: {
  promptProfileStreamParams?: AgentStreamParams;
  streamParams?: AgentStreamParams;
}): AgentStreamParams | undefined {
  const merged = {
    ...params.promptProfileStreamParams,
    ...params.streamParams,
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
