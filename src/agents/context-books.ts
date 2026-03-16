import { createHash } from "node:crypto";
import syncFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { openBoundaryFile } from "../infra/boundary-file-read.js";
import { isCronSessionKey, isSubagentSessionKey } from "../routing/session-key.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { deriveSessionChatType, type SessionKeyChatType } from "../sessions/session-key-utils.js";
import { joinPresentTextSegments } from "../shared/text/join-segments.js";
import { resolveUserPath } from "../utils.js";
import type { BootstrapContextMode, BootstrapContextRunKind } from "./bootstrap-files.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";

export const CONTEXT_BOOKS_DIRNAME = "context-books";

const CONTEXT_BOOK_EXTENSIONS = new Set([".json", ".yaml", ".yml"]);
const CONTEXT_BOOK_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_CONTEXT_BOOK_PROMPT_MAX_CHARS = 6_000;
const SUPPORTED_BOOTSTRAP_POSITIONS = new Set(["before_context", "after_context"]);
const SUPPORTED_PROMPT_POSITIONS = new Set([
  "before_context",
  "after_context",
  "tail_reminder",
  "at_depth",
]);

type ContextBookPosition = "before_context" | "after_context" | "tail_reminder" | "at_depth";
type ContextBookSessionKind = "default" | "cron" | "subagent";
type ContextBookSecondaryLogic = "AND_ANY" | "AND_ALL" | "NOT_ANY" | "NOT_ALL";

type RawContextBookDocument =
  | {
      entries?: unknown;
    }
  | unknown[];

type NormalizedContextBookEntry = {
  name: string;
  syntheticName: string;
  syntheticPath: string;
  content: string;
  order: number;
  depth: number;
  group: string;
  groupWeight: number;
  alwaysActive: boolean;
  ignoreBudget: boolean;
  keywords: string[];
  secondaryKeywords: string[];
  secondaryLogic: ContextBookSecondaryLogic;
  agentIds: string[];
  channels: string[];
  chatTypes: SessionKeyChatType[];
  sessionKinds: ContextBookSessionKind[];
  position: ContextBookPosition;
  sourcePath: string;
  sourceIndex: number;
};

export type ContextBookPromptContext = {
  prependSystemContext?: string;
  appendSystemContext?: string;
  atDepthEntries: Array<{
    name: string;
    content: string;
    depth: number;
  }>;
  matchedEntryNames: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseOrder(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}

function parseGroup(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseGroupWeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function parseDepth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function parseSessionKinds(value: unknown): ContextBookSessionKind[] {
  return parseStringArray(value)
    .map((item) => item.toLowerCase())
    .filter(
      (item): item is ContextBookSessionKind =>
        item === "default" || item === "cron" || item === "subagent",
    );
}

function parseChatTypes(value: unknown): SessionKeyChatType[] {
  return parseStringArray(value)
    .map((item) => item.toLowerCase())
    .filter(
      (item): item is SessionKeyChatType =>
        item === "direct" || item === "group" || item === "channel" || item === "unknown",
    );
}

function parseSecondaryLogic(value: unknown): ContextBookSecondaryLogic {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (
    normalized === "AND_ANY" ||
    normalized === "AND_ALL" ||
    normalized === "NOT_ANY" ||
    normalized === "NOT_ALL"
  ) {
    return normalized;
  }
  return "AND_ANY";
}

function normalizeEntryName(rawName: unknown, sourcePath: string, index: number): string {
  const trimmed = typeof rawName === "string" ? rawName.trim() : "";
  if (trimmed) {
    return trimmed;
  }
  return `${path.basename(sourcePath)}#${index + 1}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "entry";
}

function parsePosition(value: unknown): ContextBookPosition {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (trimmed === "before_context" || trimmed === "tail_reminder" || trimmed === "at_depth") {
    return trimmed;
  }
  return "after_context";
}

function parseContextBookDocument(raw: string, sourcePath: string): RawContextBookDocument | null {
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
      return parsed as RawContextBookDocument;
    }
    return null;
  } catch {
    return null;
  }
}

function formatPromptContextEntry(entry: NormalizedContextBookEntry): string {
  return [`[Context Book: ${entry.name}]`, entry.content].join("\n");
}

function extractEntries(
  document: RawContextBookDocument,
  sourcePath: string,
  warn?: (message: string) => void,
): NormalizedContextBookEntry[] {
  const rawEntries = Array.isArray(document)
    ? document
    : Array.isArray(document.entries)
      ? document.entries
      : [];
  if (!rawEntries.length) {
    return [];
  }

  const normalized: NormalizedContextBookEntry[] = [];
  for (const [index, rawEntry] of rawEntries.entries()) {
    if (!isRecord(rawEntry)) {
      warn?.(`skipping context book entry ${sourcePath}#${index + 1} - entry must be an object`);
      continue;
    }

    const enabled = parseBoolean(rawEntry.enabled, true);
    const alwaysActive = parseBoolean(rawEntry.alwaysActive, false);
    const ignoreBudget = parseBoolean(rawEntry.ignoreBudget, false);
    const group = parseGroup(rawEntry.group);
    const groupWeight = parseGroupWeight(rawEntry.groupWeight);
    const keywords = parseStringArray(rawEntry.keywords);
    const secondaryKeywords = parseStringArray(rawEntry.secondaryKeywords);
    const secondaryLogic = parseSecondaryLogic(rawEntry.secondaryLogic);
    const agentIds = parseStringArray(rawEntry.agentIds).map((item) => item.toLowerCase());
    const channels = parseStringArray(rawEntry.channels).map((item) => item.toLowerCase());
    const chatTypes = parseChatTypes(rawEntry.chatTypes);
    const sessionKinds = parseSessionKinds(rawEntry.sessionKinds);
    if (!enabled || (!alwaysActive && keywords.length === 0)) {
      continue;
    }

    const content = typeof rawEntry.content === "string" ? rawEntry.content.trim() : "";
    if (!content) {
      warn?.(`skipping context book entry ${sourcePath}#${index + 1} - missing content`);
      continue;
    }

    const position = parsePosition(rawEntry.position);
    if (!SUPPORTED_PROMPT_POSITIONS.has(position)) {
      warn?.(
        `skipping context book entry ${sourcePath}#${index + 1} - unsupported position "${position}" in Context Book v1`,
      );
      continue;
    }

    const entryName = normalizeEntryName(rawEntry.name, sourcePath, index);
    normalized.push({
      name: entryName,
      syntheticName: `CONTEXT_BOOK:${entryName}`,
      syntheticPath: `${sourcePath}#${slugify(entryName)}`,
      content,
      order: parseOrder(rawEntry.order),
      depth: parseDepth(rawEntry.depth),
      group,
      groupWeight,
      alwaysActive,
      ignoreBudget,
      keywords,
      secondaryKeywords,
      secondaryLogic,
      agentIds,
      channels,
      chatTypes,
      sessionKinds,
      position,
      sourcePath,
      sourceIndex: index,
    });
  }

  normalized.sort((a, b) => {
    if (a.order !== b.order) {
      return b.order - a.order;
    }
    if (a.sourcePath !== b.sourcePath) {
      return a.sourcePath.localeCompare(b.sourcePath);
    }
    return a.sourceIndex - b.sourceIndex;
  });
  return normalized;
}

async function readContextBookFile(params: {
  workspaceDir: string;
  filePath: string;
  warn?: (message: string) => void;
}): Promise<string | undefined> {
  const opened = await openBoundaryFile({
    absolutePath: params.filePath,
    rootPath: params.workspaceDir,
    boundaryLabel: "workspace root",
    maxBytes: CONTEXT_BOOK_MAX_FILE_BYTES,
  });
  if (!opened.ok) {
    params.warn?.(
      `skipping context book ${params.filePath} - ${opened.reason === "validation" ? "invalid file" : opened.reason}`,
    );
    return undefined;
  }

  try {
    return syncFs.readFileSync(opened.fd, "utf-8");
  } catch {
    params.warn?.(`skipping context book ${params.filePath} - failed to read file`);
    return undefined;
  } finally {
    syncFs.closeSync(opened.fd);
  }
}

function shouldSkipContextBooks(params: {
  sessionKey?: string;
  contextMode?: BootstrapContextMode;
  runKind?: BootstrapContextRunKind;
}): boolean {
  if (params.contextMode === "lightweight") {
    return true;
  }
  if (params.runKind === "heartbeat" || params.runKind === "cron") {
    return true;
  }
  const sessionKey = params.sessionKey;
  if (!sessionKey) {
    return false;
  }
  // Keep current prompt minimization behavior for cron/subagent sessions until
  // sessionKinds-aware Context Book routing lands.
  return isSubagentSessionKey(sessionKey) || isCronSessionKey(sessionKey);
}

async function loadContextBookEntries(params: {
  workspaceDir: string;
  warn?: (message: string) => void;
}): Promise<NormalizedContextBookEntry[]> {
  const workspaceDir = resolveUserPath(params.workspaceDir);
  const contextBooksDir = path.join(workspaceDir, CONTEXT_BOOKS_DIRNAME);
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(contextBooksDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    params.warn?.(`failed to read context-books directory: ${contextBooksDir}`);
    return [];
  }

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => CONTEXT_BOOK_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .toSorted((a, b) => a.localeCompare(b));

  const normalizedEntries: NormalizedContextBookEntry[] = [];
  for (const fileName of files) {
    const filePath = path.join(contextBooksDir, fileName);
    const raw = await readContextBookFile({
      workspaceDir,
      filePath,
      warn: params.warn,
    });
    if (!raw) {
      continue;
    }
    const parsed = parseContextBookDocument(raw, filePath);
    if (!parsed) {
      params.warn?.(`skipping context book ${filePath} - invalid YAML/JSON document`);
      continue;
    }
    normalizedEntries.push(...extractEntries(parsed, filePath, params.warn));
  }

  normalizedEntries.sort((a, b) => {
    if (a.order !== b.order) {
      return b.order - a.order;
    }
    if (a.sourcePath !== b.sourcePath) {
      return a.sourcePath.localeCompare(b.sourcePath);
    }
    return a.sourceIndex - b.sourceIndex;
  });
  return normalizedEntries;
}

function extractTextSegments(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextSegments(entry));
  }
  if (!isRecord(value)) {
    return [];
  }

  const segments: string[] = [];
  if (typeof value.text === "string") {
    segments.push(value.text);
  }
  if ("content" in value) {
    segments.push(...extractTextSegments(value.content));
  }
  return segments;
}

function buildMessageKeywordHaystack(messages: unknown[]): string {
  return messages
    .flatMap((message) => extractTextSegments(message))
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0)
    .join("\n");
}

function matchesEntryKeywords(entry: NormalizedContextBookEntry, haystack: string): boolean {
  if (!haystack || entry.keywords.length === 0) {
    return false;
  }
  const primaryMatched = entry.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
  if (!primaryMatched) {
    return false;
  }
  if (entry.secondaryKeywords.length === 0) {
    return true;
  }
  const secondaryMatches = entry.secondaryKeywords.map((keyword) =>
    haystack.includes(keyword.toLowerCase()),
  );
  switch (entry.secondaryLogic) {
    case "AND_ALL":
      return secondaryMatches.every(Boolean);
    case "NOT_ANY":
      return secondaryMatches.every((matched) => !matched);
    case "NOT_ALL":
      return !secondaryMatches.every(Boolean);
    case "AND_ANY":
    default:
      return secondaryMatches.some(Boolean);
  }
}

function shouldInjectViaPromptContext(
  entry: NormalizedContextBookEntry,
  haystack: string,
): boolean {
  if (entry.alwaysActive && !SUPPORTED_BOOTSTRAP_POSITIONS.has(entry.position)) {
    return true;
  }
  return matchesEntryKeywords(entry, haystack);
}

function resolveContextBookSessionKind(sessionKey: string | undefined): ContextBookSessionKind {
  if (isSubagentSessionKey(sessionKey)) {
    return "subagent";
  }
  if (isCronSessionKey(sessionKey)) {
    return "cron";
  }
  return "default";
}

function matchesOptionalFilter(filterValues: string[], actualValue: string | undefined): boolean {
  if (filterValues.length === 0) {
    return true;
  }
  const normalized = actualValue?.trim().toLowerCase();
  return Boolean(normalized) && filterValues.includes(normalized);
}

function matchesSessionKindFilter(
  filterValues: ContextBookSessionKind[],
  actualValue: ContextBookSessionKind,
): boolean {
  if (filterValues.length === 0) {
    return true;
  }
  return filterValues.includes(actualValue);
}

function matchesChatTypeFilter(
  filterValues: SessionKeyChatType[],
  actualValue: SessionKeyChatType,
): boolean {
  if (filterValues.length === 0) {
    return true;
  }
  return filterValues.includes(actualValue);
}

function matchesEntryScope(params: {
  entry: NormalizedContextBookEntry;
  sessionKey?: string;
  agentId?: string;
  channelId?: string;
}): boolean {
  const agentId =
    params.agentId?.trim().toLowerCase() ??
    resolveAgentIdFromSessionKey(params.sessionKey).trim().toLowerCase();
  const channelId = params.channelId?.trim().toLowerCase();
  const sessionKind = resolveContextBookSessionKind(params.sessionKey);
  const chatType = deriveSessionChatType(params.sessionKey);

  return (
    matchesOptionalFilter(params.entry.agentIds, agentId) &&
    matchesOptionalFilter(params.entry.channels, channelId) &&
    matchesChatTypeFilter(params.entry.chatTypes, chatType) &&
    matchesSessionKindFilter(params.entry.sessionKinds, sessionKind)
  );
}

function buildPromptContextSection(
  entries: NormalizedContextBookEntry[],
  position: ContextBookPosition,
): string | undefined {
  const filtered = entries.filter((entry) => entry.position === position);
  if (filtered.length === 0) {
    return undefined;
  }
  return joinPresentTextSegments(filtered.map((entry) => formatPromptContextEntry(entry)));
}

function buildAtDepthEntries(entries: NormalizedContextBookEntry[]): Array<{
  name: string;
  content: string;
  depth: number;
}> {
  return entries
    .filter((entry) => entry.position === "at_depth")
    .map((entry) => ({
      name: entry.name,
      content: formatPromptContextEntry(entry),
      depth: entry.depth,
    }));
}

function buildDeterministicGroupFraction(seed: string): number {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 12);
  const numerator = Number.parseInt(hex, 16);
  return numerator / 0x1_0000_0000_0000;
}

function selectWeightedGroupEntry(params: {
  entries: NormalizedContextBookEntry[];
  seed: string;
}): NormalizedContextBookEntry {
  const totalWeight = params.entries.reduce((sum, entry) => sum + entry.groupWeight, 0);
  if (!(totalWeight > 0)) {
    return params.entries[0];
  }

  let cursor = buildDeterministicGroupFraction(params.seed) * totalWeight;
  for (const entry of params.entries) {
    cursor -= entry.groupWeight;
    if (cursor < 0) {
      return entry;
    }
  }
  return params.entries.at(-1) as NormalizedContextBookEntry;
}

function applyContextBookGroups(params: {
  entries: NormalizedContextBookEntry[];
  workspaceDir: string;
  sessionKey?: string;
  agentId?: string;
  channelId?: string;
  haystack?: string;
  phase: "bootstrap" | "prompt";
}): NormalizedContextBookEntry[] {
  if (params.entries.length <= 1) {
    return params.entries;
  }

  const groupedEntries = new Map<string, NormalizedContextBookEntry[]>();
  const selected = new Set<NormalizedContextBookEntry>();
  for (const entry of params.entries) {
    if (!entry.group) {
      selected.add(entry);
      continue;
    }
    const existing = groupedEntries.get(entry.group);
    if (existing) {
      existing.push(entry);
    } else {
      groupedEntries.set(entry.group, [entry]);
    }
  }

  for (const [group, entries] of groupedEntries.entries()) {
    const chosen = selectWeightedGroupEntry({
      entries,
      seed: [
        params.phase,
        group,
        resolveUserPath(params.workspaceDir),
        params.sessionKey?.trim().toLowerCase() ?? "",
        params.agentId?.trim().toLowerCase() ?? "",
        params.channelId?.trim().toLowerCase() ?? "",
        params.haystack ?? "",
      ].join("\n"),
    });
    selected.add(chosen);
  }

  return params.entries.filter((entry) => selected.has(entry));
}

function selectPromptEntriesWithinBudget(params: {
  entries: NormalizedContextBookEntry[];
  maxChars: number;
  warn?: (message: string) => void;
}): NormalizedContextBookEntry[] {
  const maxChars =
    typeof params.maxChars === "number" && Number.isFinite(params.maxChars) && params.maxChars > 0
      ? Math.floor(params.maxChars)
      : DEFAULT_CONTEXT_BOOK_PROMPT_MAX_CHARS;
  let remaining = maxChars;
  const selected: NormalizedContextBookEntry[] = [];

  for (const entry of params.entries) {
    const rendered = formatPromptContextEntry(entry);
    const cost = rendered.length + (selected.length > 0 ? 2 : 0);
    if (entry.ignoreBudget) {
      selected.push(entry);
      continue;
    }
    if (cost <= remaining) {
      selected.push(entry);
      remaining -= cost;
      continue;
    }
    params.warn?.(
      `skipping context book entry "${entry.name}" - prompt budget exceeded (${maxChars} chars)`,
    );
  }

  return selected;
}

export async function loadContextBookBootstrapFiles(params: {
  workspaceDir: string;
  sessionKey?: string;
  agentId?: string;
  contextMode?: BootstrapContextMode;
  runKind?: BootstrapContextRunKind;
  warn?: (message: string) => void;
}): Promise<WorkspaceBootstrapFile[]> {
  if (shouldSkipContextBooks(params)) {
    return [];
  }

  const entries = await loadContextBookEntries({
    workspaceDir: params.workspaceDir,
    warn: params.warn,
  });

  const matchedEntries = applyContextBookGroups({
    entries: entries.filter(
      (entry) =>
        entry.alwaysActive &&
        SUPPORTED_BOOTSTRAP_POSITIONS.has(entry.position) &&
        matchesEntryScope({
          entry,
          sessionKey: params.sessionKey,
          agentId: params.agentId,
        }),
    ),
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    phase: "bootstrap",
  });

  return matchedEntries
    .filter((entry) => entry.alwaysActive && SUPPORTED_BOOTSTRAP_POSITIONS.has(entry.position))
    .map((entry) => ({
      name: entry.syntheticName,
      path: entry.syntheticPath,
      content: entry.content,
      missing: false,
    }));
}

export async function resolveContextBookPromptContext(params: {
  workspaceDir: string;
  messages: unknown[];
  sessionKey?: string;
  agentId?: string;
  channelId?: string;
  contextMode?: BootstrapContextMode;
  runKind?: BootstrapContextRunKind;
  maxChars?: number;
  warn?: (message: string) => void;
}): Promise<ContextBookPromptContext> {
  if (shouldSkipContextBooks(params)) {
    return { atDepthEntries: [], matchedEntryNames: [] };
  }

  const entries = await loadContextBookEntries({
    workspaceDir: params.workspaceDir,
    warn: params.warn,
  });
  if (entries.length === 0) {
    return { atDepthEntries: [], matchedEntryNames: [] };
  }

  const haystack = buildMessageKeywordHaystack(params.messages);
  const groupedMatchedEntries = applyContextBookGroups({
    entries: entries.filter(
      (entry) =>
        matchesEntryScope({
          entry,
          sessionKey: params.sessionKey,
          agentId: params.agentId,
          channelId: params.channelId,
        }) && shouldInjectViaPromptContext(entry, haystack),
    ),
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    channelId: params.channelId,
    haystack,
    phase: "prompt",
  });
  const matched = selectPromptEntriesWithinBudget({
    entries: groupedMatchedEntries,
    maxChars: params.maxChars ?? DEFAULT_CONTEXT_BOOK_PROMPT_MAX_CHARS,
    warn: params.warn,
  });
  if (matched.length === 0) {
    return { atDepthEntries: [], matchedEntryNames: [] };
  }

  const prependSystemContext = joinPresentTextSegments(
    [buildPromptContextSection(matched, "before_context")].filter(Boolean),
  );
  const appendSystemContext = joinPresentTextSegments(
    [
      buildPromptContextSection(matched, "after_context"),
      buildPromptContextSection(matched, "tail_reminder"),
    ].filter(Boolean),
  );

  return {
    prependSystemContext,
    appendSystemContext,
    atDepthEntries: buildAtDepthEntries(matched),
    matchedEntryNames: matched.map((entry) => entry.name),
  };
}
