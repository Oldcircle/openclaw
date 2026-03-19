/**
 * Experience extractor for session-memory hook
 *
 * Analyzes session conversation to extract reusable experience rules.
 * Extracted experiences are appended as Context Book entries to context-books/learned.yaml.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveDefaultAgentId,
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
} from "../../../agents/agent-scope.js";
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from "../../../agents/defaults.js";
import { parseModelRef } from "../../../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../../../agents/pi-embedded.js";
import type { OpenClawConfig } from "../../../config/config.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";

const log = createSubsystemLogger("hooks/experience-extractor");

const EXPERIENCE_PROMPT = `Analyze this conversation. If any of the following patterns occurred, extract ONE experience rule. If none occurred, reply with exactly "none".

Patterns to look for:
1. The AI made a mistake or went in a wrong direction, and the user corrected it
2. The user expressed a specific preference or requirement that the AI should remember
3. A non-obvious solution was discovered after some troubleshooting

If you find a pattern, output ONLY the following YAML (no markdown fences, no explanation):
name: short title (under 40 chars)
keywords:
  - keyword1
  - keyword2
  - keyword3
  - keyword4
  - keyword5
situation: what scenario triggers this (1-2 sentences)
conclusion:
  - actionable rule 1
  - actionable rule 2
  - actionable rule 3

IMPORTANT: Write conclusion rules as direct, imperative instructions that will be injected into the AI's system prompt. Use commanding language like "DO", "MUST", "ALWAYS", "NEVER". Do NOT write them as notes or descriptions. Bad: "记住用户偏好". Good: "当用户说查天气时，必须直接查深圳天气，不要询问城市".

Conversation:
`;

type ExperienceEntry = {
  name: string;
  keywords: string[];
  situation: string;
  conclusion: string[];
};

function parseExperienceYaml(text: string): ExperienceEntry | null {
  const trimmed = text.trim();
  if (trimmed === "none" || trimmed.toLowerCase().startsWith("none")) {
    return null;
  }

  // Remove markdown fences if present
  const cleaned = trimmed
    .replace(/^```ya?ml?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  try {
    const nameMatch = cleaned.match(/^name:\s*(.+)$/m);
    const situationMatch = cleaned.match(/^situation:\s*(.+)$/m);

    if (!nameMatch || !situationMatch) {
      return null;
    }

    const name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    const situation = situationMatch[1].trim().replace(/^["']|["']$/g, "");

    // Parse keywords array
    const keywordsSection = cleaned.match(/keywords:\s*\n((?:\s*-\s*.+\n?)+)/);
    const keywords = keywordsSection
      ? keywordsSection[1]
          .split("\n")
          .map((line) =>
            line
              .replace(/^\s*-\s*/, "")
              .trim()
              .replace(/^["']|["']$/g, ""),
          )
          .filter(Boolean)
      : [];

    // Parse conclusion array
    const conclusionSection = cleaned.match(/conclusion:\s*\n((?:\s*-\s*.+\n?)+)/);
    const conclusion = conclusionSection
      ? conclusionSection[1]
          .split("\n")
          .map((line) =>
            line
              .replace(/^\s*-\s*/, "")
              .trim()
              .replace(/^["']|["']$/g, ""),
          )
          .filter(Boolean)
      : [];

    if (!name || keywords.length === 0 || conclusion.length === 0) {
      return null;
    }

    return { name, keywords, situation, conclusion };
  } catch {
    return null;
  }
}

function formatExperienceAsYamlEntry(experience: ExperienceEntry, sessionId: string): string {
  const now = new Date().toISOString().split("T")[0];
  const keywordsYaml = experience.keywords.map((k) => `      - "${k}"`).join("\n");
  const conclusionLines = experience.conclusion.map((c) => `      - ${c}`).join("\n");

  return `
  - name: "${experience.name}"
    keywords:
${keywordsYaml}
    position: tail_reminder
    order: 30
    content: |
      [经验规则] ${experience.name}
${conclusionLines}
    source: auto
    sourceSession: "session:${sessionId}"
    confidence: low
    hitCount: 0
    lastHitAt: ""
    situation: |
      ${experience.situation}
    createdAt: "${now}"`;
}

const LEARNED_YAML_HEADER = `# Auto-generated experience entries (managed by session-memory hook)
# Do not edit hitCount/confidence/lastHitAt manually — updated by memory-enhance plugin
entries:`;

export async function extractExperienceFromSession(params: {
  sessionContent: string;
  sessionId: string;
  workspaceDir: string;
  cfg: OpenClawConfig;
}): Promise<void> {
  const { sessionContent, sessionId, workspaceDir, cfg } = params;

  const agentId = resolveDefaultAgentId(cfg);
  const agentDir = resolveAgentDir(cfg, agentId);
  const modelRef = resolveAgentEffectiveModelPrimary(cfg, agentId);
  const parsed = modelRef ? parseModelRef(modelRef, DEFAULT_PROVIDER) : null;
  const provider = parsed?.provider ?? DEFAULT_PROVIDER;
  const model = parsed?.model ?? DEFAULT_MODEL;

  const prompt = EXPERIENCE_PROMPT + sessionContent.slice(0, 3000);

  log.debug("Extracting experience from session", {
    sessionId,
    contentLength: sessionContent.length,
  });

  const result = await runEmbeddedPiAgent({
    sessionId: `exp-extract-${Date.now()}`,
    sessionKey: "temp:experience-extractor",
    agentId,
    sessionFile: "",
    workspaceDir,
    agentDir,
    config: cfg,
    prompt,
    provider,
    model,
    timeoutMs: 60_000,
    runId: `exp-extract-${Date.now()}`,
  });

  const responseText = result.payloads?.[0]?.text;
  if (!responseText) {
    log.debug("No response from experience extraction LLM call");
    return;
  }

  const experience = parseExperienceYaml(responseText);
  if (!experience) {
    log.debug("No experience extracted (response was 'none' or unparseable)");
    return;
  }

  // Append to context-books/learned.yaml
  const contextBooksDir = path.join(workspaceDir, "context-books");
  await fs.mkdir(contextBooksDir, { recursive: true });

  const learnedPath = path.join(contextBooksDir, "learned.yaml");
  let existingContent: string;
  try {
    existingContent = await fs.readFile(learnedPath, "utf-8");
  } catch {
    existingContent = "";
  }

  const entryYaml = formatExperienceAsYamlEntry(experience, sessionId);

  if (!existingContent.trim()) {
    // New file
    await fs.writeFile(learnedPath, LEARNED_YAML_HEADER + "\n" + entryYaml + "\n", "utf-8");
  } else {
    // Append to existing
    await fs.writeFile(learnedPath, existingContent.trimEnd() + "\n" + entryYaml + "\n", "utf-8");
  }

  log.info(`Experience extracted: "${experience.name}" → context-books/learned.yaml`);
}
