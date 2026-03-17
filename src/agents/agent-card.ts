import syncFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { openBoundaryFile } from "../infra/boundary-file-read.js";
import { resolveUserPath } from "../utils.js";
import type { WorkspaceBootstrapFile, WorkspaceBootstrapFileName } from "./workspace.js";
import {
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_USER_FILENAME,
} from "./workspace.js";

const AGENT_CARD_FILENAMES = ["agent-card.yaml", "agent-card.yml", "agent-card.json"] as const;
const AGENT_CARD_MAX_FILE_BYTES = 256 * 1024;

type RawAgentCard = Record<string, unknown>;

export type AgentCardPromptContext = {
  defaultContextBook?: string;
  defaultPromptProfile?: string;
  atDepthEntries: Array<{
    name: string;
    content: string;
    depth: number;
  }>;
};

export type AgentCardDefaults = Pick<
  AgentCardPromptContext,
  "defaultContextBook" | "defaultPromptProfile"
>;

type LoadedAgentCard = {
  sourcePath: string;
  card: RawAgentCard;
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

function parseDepth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

async function readAgentCardFile(params: {
  workspaceDir: string;
  filePath: string;
  warn?: (message: string) => void;
}): Promise<string | undefined> {
  const opened = await openBoundaryFile({
    absolutePath: params.filePath,
    rootPath: params.workspaceDir,
    boundaryLabel: "workspace root",
    maxBytes: AGENT_CARD_MAX_FILE_BYTES,
  });
  if (!opened.ok) {
    params.warn?.(
      `skipping agent card ${params.filePath} - ${opened.reason === "validation" ? "invalid file" : opened.reason}`,
    );
    return undefined;
  }

  try {
    return syncFs.readFileSync(opened.fd, "utf-8");
  } catch {
    params.warn?.(`skipping agent card ${params.filePath} - failed to read file`);
    return undefined;
  } finally {
    syncFs.closeSync(opened.fd);
  }
}

function parseAgentCardDocument(raw: string, sourcePath: string): RawAgentCard | null {
  const extension = path.extname(sourcePath).toLowerCase();
  try {
    const parsed =
      extension === ".json"
        ? (JSON.parse(raw) as unknown)
        : (YAML.parse(raw, { schema: "core" }) as unknown);
    return isRecord(parsed) ? (parsed as RawAgentCard) : null;
  } catch {
    return null;
  }
}

function buildSyntheticSection(params: {
  sourcePath: string;
  name: WorkspaceBootstrapFileName;
  content: string;
}): WorkspaceBootstrapFile {
  return {
    name: params.name,
    path: `${params.sourcePath}#${params.name}`,
    content: params.content,
    missing: false,
  };
}

function resolveAgentCardName(card: RawAgentCard, sourcePath: string): string {
  if (!isRecord(card)) {
    return path.basename(sourcePath);
  }
  return parseString(card.name) || path.basename(sourcePath, path.extname(sourcePath));
}

function buildIdentitySection(
  card: RawAgentCard,
  sourcePath: string,
): WorkspaceBootstrapFile | null {
  if (!isRecord(card)) {
    return null;
  }
  const identity = parseString(card.identity);
  if (!identity) {
    return null;
  }
  return buildSyntheticSection({
    sourcePath,
    name: DEFAULT_IDENTITY_FILENAME,
    content: ["# IDENTITY.md - Agent Card", "", identity].join("\n"),
  });
}

function buildSoulSection(card: RawAgentCard, sourcePath: string): WorkspaceBootstrapFile | null {
  if (!isRecord(card)) {
    return null;
  }
  const personality = parseString(card.personality);
  const tone = parseString(card.tone);
  const behaviorNotes = parseStringArray(card.behavior_notes);
  const exampleDialogues = parseString(card.example_dialogues);
  const { defaultContextBook, defaultPromptProfile } = extractAgentCardDefaults(card);
  const lines = [
    "# SOUL.md - Agent Card",
    personality ? ["## Personality", personality, ""].join("\n") : "",
    tone ? ["## Tone", tone, ""].join("\n") : "",
    behaviorNotes.length
      ? ["## Behavior Notes", ...behaviorNotes.map((note) => `- ${note}`), ""].join("\n")
      : "",
    exampleDialogues ? ["## Example Dialogues", exampleDialogues, ""].join("\n") : "",
    defaultContextBook || defaultPromptProfile
      ? [
          "## Defaults",
          defaultContextBook ? `- Context Book: ${defaultContextBook}` : "",
          defaultPromptProfile ? `- Prompt Profile: ${defaultPromptProfile}` : "",
          "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
  ].filter(Boolean);
  if (lines.length <= 1) {
    return null;
  }
  return buildSyntheticSection({
    sourcePath,
    name: DEFAULT_SOUL_FILENAME,
    content: lines.join("\n"),
  });
}

function buildUserSection(card: RawAgentCard, sourcePath: string): WorkspaceBootstrapFile | null {
  if (!isRecord(card)) {
    return null;
  }
  const userRelationship = parseString(card.user_relationship);
  if (!userRelationship) {
    return null;
  }
  return buildSyntheticSection({
    sourcePath,
    name: DEFAULT_USER_FILENAME,
    content: ["# USER.md - Agent Card", "", userRelationship].join("\n"),
  });
}

function buildDepthPromptEntry(
  card: RawAgentCard,
  sourcePath: string,
): AgentCardPromptContext["atDepthEntries"][number] | null {
  if (!isRecord(card) || !isRecord(card.depth_prompt)) {
    return null;
  }
  const content = parseString(card.depth_prompt.content);
  if (!content) {
    return null;
  }
  const cardName = resolveAgentCardName(card, sourcePath);
  return {
    name: `${cardName} depth_prompt`,
    content: [`[Agent Card Depth Prompt: ${cardName}]`, content].join("\n"),
    depth: parseDepth(card.depth_prompt.depth),
  };
}

function extractAgentCardDefaults(card: RawAgentCard): AgentCardDefaults {
  if (!isRecord(card)) {
    return {};
  }

  const defaultContextBook = parseString(card.default_context_book) || undefined;
  const defaultPromptProfile = parseString(card.default_prompt_profile) || undefined;
  return {
    defaultContextBook,
    defaultPromptProfile,
  };
}

async function loadAgentCardDocument(params: {
  workspaceDir: string;
  warn?: (message: string) => void;
}): Promise<LoadedAgentCard | null> {
  const workspaceDir = resolveUserPath(params.workspaceDir);
  for (const fileName of AGENT_CARD_FILENAMES) {
    const filePath = path.join(workspaceDir, fileName);
    let exists = true;
    try {
      await fs.access(filePath);
    } catch {
      exists = false;
    }
    if (!exists) {
      continue;
    }

    const raw = await readAgentCardFile({
      workspaceDir,
      filePath,
      warn: params.warn,
    });
    if (!raw) {
      return null;
    }
    const parsed = parseAgentCardDocument(raw, filePath);
    if (!parsed) {
      params.warn?.(`skipping agent card ${filePath} - invalid YAML/JSON document`);
      return null;
    }

    return {
      sourcePath: filePath,
      card: parsed,
    };
  }
  return null;
}

export async function loadAgentCardBootstrapFiles(params: {
  workspaceDir: string;
  warn?: (message: string) => void;
}): Promise<WorkspaceBootstrapFile[]> {
  const loaded = await loadAgentCardDocument(params);
  if (!loaded) {
    return [];
  }

  return [
    buildIdentitySection(loaded.card, loaded.sourcePath),
    buildSoulSection(loaded.card, loaded.sourcePath),
    buildUserSection(loaded.card, loaded.sourcePath),
  ].filter((entry): entry is WorkspaceBootstrapFile => Boolean(entry));
}

export async function resolveAgentCardBootstrapState(params: {
  workspaceDir: string;
  warn?: (message: string) => void;
}): Promise<{
  bootstrapFiles: WorkspaceBootstrapFile[];
  defaults: AgentCardDefaults;
}> {
  const loaded = await loadAgentCardDocument(params);
  if (!loaded) {
    return {
      bootstrapFiles: [],
      defaults: {},
    };
  }

  return {
    bootstrapFiles: [
      buildIdentitySection(loaded.card, loaded.sourcePath),
      buildSoulSection(loaded.card, loaded.sourcePath),
      buildUserSection(loaded.card, loaded.sourcePath),
    ].filter((entry): entry is WorkspaceBootstrapFile => Boolean(entry)),
    defaults: extractAgentCardDefaults(loaded.card),
  };
}

export async function resolveAgentCardPromptContext(params: {
  workspaceDir: string;
  warn?: (message: string) => void;
}): Promise<AgentCardPromptContext> {
  const loaded = await loadAgentCardDocument(params);
  if (!loaded) {
    return { atDepthEntries: [] };
  }

  return {
    ...extractAgentCardDefaults(loaded.card),
    atDepthEntries: [buildDepthPromptEntry(loaded.card, loaded.sourcePath)].filter(
      (entry): entry is AgentCardPromptContext["atDepthEntries"][number] => Boolean(entry),
    ),
  };
}
