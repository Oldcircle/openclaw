import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_USER_FILENAME,
} from "../../agents/workspace.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import { shortenHomePath } from "../../utils.js";
import { loadValidConfigOrThrow, resolveKnownAgentId } from "../models/shared.js";

export type AssetsMigrateOptions = {
  agent?: string;
  dryRun?: boolean;
  config?: OpenClawConfig;
};

const AGENT_CARD_FILENAMES = ["agent-card.yaml", "agent-card.yml", "agent-card.json"] as const;

export async function assetsMigrateCommand(
  runtime: RuntimeEnv,
  options: AssetsMigrateOptions = {},
) {
  const cfg = options.config ?? (await loadValidConfigOrThrow());
  const agentId =
    resolveKnownAgentId({ cfg, rawAgentId: options.agent }) ?? resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  // Check if agent card already exists
  for (const fileName of AGENT_CARD_FILENAMES) {
    const filePath = path.join(workspaceDir, fileName);
    try {
      await fs.access(filePath);
      runtime.log(`Agent Card already exists: ${shortenHomePath(filePath)}`);
      runtime.log("Migration skipped. Delete the existing Agent Card to re-run migration.");
      return;
    } catch {
      continue;
    }
  }

  // Read old bootstrap files
  const soulContent = await readFileIfExists(path.join(workspaceDir, DEFAULT_SOUL_FILENAME));
  const identityContent = await readFileIfExists(
    path.join(workspaceDir, DEFAULT_IDENTITY_FILENAME),
  );
  const userContent = await readFileIfExists(path.join(workspaceDir, DEFAULT_USER_FILENAME));

  if (!soulContent && !identityContent && !userContent) {
    runtime.log("No bootstrap files found (SOUL.md, IDENTITY.md, USER.md). Nothing to migrate.");
    return;
  }

  const card: Record<string, unknown> = {};

  if (identityContent) {
    card.identity = identityContent.trim();
  }

  if (soulContent) {
    const { personality, tone } = parseSoulContent(soulContent);
    if (personality) {
      card.personality = personality;
    }
    if (tone) {
      card.tone = tone;
    }
    // If we couldn't parse structured fields, put the whole thing as personality
    if (!personality && !tone && soulContent.trim()) {
      card.personality = soulContent.trim();
    }
  }

  if (userContent) {
    card.user_relationship = userContent.trim();
  }

  if (options.dryRun) {
    runtime.log("--- Dry run: generated Agent Card ---\n");
    runtime.log(YAML.stringify(card, { lineWidth: 0 }));
    runtime.log("---");
    runtime.log("\nRun without --dry-run to write the file.");
    return;
  }

  const destPath = path.join(workspaceDir, "agent-card.yaml");
  await fs.writeFile(destPath, YAML.stringify(card, { lineWidth: 0 }), "utf-8");

  runtime.log(`Generated Agent Card: ${shortenHomePath(destPath)}`);

  const sources: string[] = [];
  if (identityContent) sources.push(DEFAULT_IDENTITY_FILENAME);
  if (soulContent) sources.push(DEFAULT_SOUL_FILENAME);
  if (userContent) sources.push(DEFAULT_USER_FILENAME);
  runtime.log(`Sources: ${sources.join(", ")}`);
  runtime.log("\nThe old files are preserved. Remove them manually when ready.");
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

function parseSoulContent(content: string): { personality?: string; tone?: string } {
  const lines = content.split("\n");
  let personality: string | undefined;
  let tone: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    // Look for common patterns like "Personality: ..." or "Tone: ..."
    const personalityMatch = trimmed.match(/^(?:personality|人格|性格)\s*[:：]\s*(.+)/i);
    if (personalityMatch) {
      personality = personalityMatch[1]!.trim();
      continue;
    }
    const toneMatch = trimmed.match(/^(?:tone|语气|风格)\s*[:：]\s*(.+)/i);
    if (toneMatch) {
      tone = toneMatch[1]!.trim();
    }
  }

  return { personality, tone };
}
