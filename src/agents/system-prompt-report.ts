import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";
import { buildBootstrapInjectionStats } from "./bootstrap-budget.js";
import { CONTEXT_BOOK_SYNTHETIC_NAME_PREFIX } from "./context-books.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import type { PromptProfilePromptContext } from "./prompt-profiles.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";

function extractBetween(
  input: string,
  startMarker: string,
  endMarker: string,
): { text: string; found: boolean } {
  const start = input.indexOf(startMarker);
  if (start === -1) {
    return { text: "", found: false };
  }
  const end = input.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    return { text: input.slice(start), found: true };
  }
  return { text: input.slice(start, end), found: true };
}

function parseSkillBlocks(skillsPrompt: string): Array<{ name: string; blockChars: number }> {
  const prompt = skillsPrompt.trim();
  if (!prompt) {
    return [];
  }
  const blocks = Array.from(prompt.matchAll(/<skill>[\s\S]*?<\/skill>/gi)).map(
    (match) => match[0] ?? "",
  );
  return blocks
    .map((block) => {
      const name = block.match(/<name>\s*([^<]+?)\s*<\/name>/i)?.[1]?.trim() || "(unknown)";
      return { name, blockChars: block.length };
    })
    .filter((b) => b.blockChars > 0);
}

function buildToolsEntries(tools: AgentTool[]): SessionSystemPromptReport["tools"]["entries"] {
  return tools.map((tool) => {
    const name = tool.name;
    const summary = tool.description?.trim() || tool.label?.trim() || "";
    const summaryChars = summary.length;
    const schemaChars = (() => {
      if (!tool.parameters || typeof tool.parameters !== "object") {
        return 0;
      }
      try {
        return JSON.stringify(tool.parameters).length;
      } catch {
        return 0;
      }
    })();
    const propertiesCount = (() => {
      const schema =
        tool.parameters && typeof tool.parameters === "object"
          ? (tool.parameters as Record<string, unknown>)
          : null;
      const props = schema && typeof schema.properties === "object" ? schema.properties : null;
      if (!props || typeof props !== "object") {
        return null;
      }
      return Object.keys(props as Record<string, unknown>).length;
    })();
    return { name, summaryChars, schemaChars, propertiesCount };
  });
}

function extractToolListText(systemPrompt: string): string {
  const markerA = "Tool names are case-sensitive. Call tools exactly as listed.\n";
  const markerB =
    "\nTOOLS.md does not control tool availability; it is user guidance for how to use external tools.";
  const extracted = extractBetween(systemPrompt, markerA, markerB);
  if (!extracted.found) {
    return "";
  }
  return extracted.text.replace(markerA, "").trim();
}

function buildContextBookReport(params: {
  bootstrapFiles: WorkspaceBootstrapFile[];
  injectedFiles: EmbeddedContextFile[];
  matchedEntryNames?: string[];
  atDepthEntries?: Array<{ name: string; depth: number; chars: number }>;
}): NonNullable<SessionSystemPromptReport["contextBooks"]> {
  const entries = buildBootstrapInjectionStats({
    bootstrapFiles: params.bootstrapFiles.filter((file) =>
      file.name.startsWith(CONTEXT_BOOK_SYNTHETIC_NAME_PREFIX),
    ),
    injectedFiles: params.injectedFiles,
  }).map((entry) => ({
    name: entry.name.slice(CONTEXT_BOOK_SYNTHETIC_NAME_PREFIX.length) || entry.name,
    path: entry.path,
    rawChars: entry.rawChars,
    injectedChars: entry.injectedChars,
    truncated: entry.truncated,
  }));
  return {
    projectContextChars: entries.reduce((sum, entry) => sum + entry.injectedChars, 0),
    projectContextEntries: entries,
    matchedEntryNames: Array.isArray(params.matchedEntryNames) ? params.matchedEntryNames : [],
    atDepthEntries: Array.isArray(params.atDepthEntries) ? params.atDepthEntries : [],
  };
}

export function buildSystemPromptReport(params: {
  source: SessionSystemPromptReport["source"];
  generatedAt: number;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  model?: string;
  workspaceDir?: string;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars?: number;
  bootstrapTruncation?: SessionSystemPromptReport["bootstrapTruncation"];
  sandbox?: SessionSystemPromptReport["sandbox"];
  systemPrompt: string;
  bootstrapFiles: WorkspaceBootstrapFile[];
  injectedFiles: EmbeddedContextFile[];
  contextBookMatchedEntryNames?: string[];
  contextBookAtDepthEntries?: Array<{ name: string; depth: number; chars: number }>;
  promptProfileContext?: PromptProfilePromptContext;
  skillsPrompt: string;
  tools: AgentTool[];
}): SessionSystemPromptReport {
  const systemPrompt = params.systemPrompt.trim();
  const projectContext = extractBetween(
    systemPrompt,
    "\n# Project Context\n",
    "\n## Silent Replies\n",
  );
  const projectContextChars = projectContext.text.length;
  const toolListText = extractToolListText(systemPrompt);
  const toolListChars = toolListText.length;
  const toolsEntries = buildToolsEntries(params.tools);
  const toolsSchemaChars = toolsEntries.reduce((sum, t) => sum + (t.schemaChars ?? 0), 0);
  const skillsEntries = parseSkillBlocks(params.skillsPrompt);

  return {
    source: params.source,
    generatedAt: params.generatedAt,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.model,
    workspaceDir: params.workspaceDir,
    bootstrapMaxChars: params.bootstrapMaxChars,
    bootstrapTotalMaxChars: params.bootstrapTotalMaxChars,
    ...(params.bootstrapTruncation ? { bootstrapTruncation: params.bootstrapTruncation } : {}),
    sandbox: params.sandbox,
    systemPrompt: {
      chars: systemPrompt.length,
      projectContextChars,
      nonProjectContextChars: Math.max(0, systemPrompt.length - projectContextChars),
    },
    injectedWorkspaceFiles: buildBootstrapInjectionStats({
      bootstrapFiles: params.bootstrapFiles,
      injectedFiles: params.injectedFiles,
    }),
    contextBooks: buildContextBookReport({
      bootstrapFiles: params.bootstrapFiles,
      injectedFiles: params.injectedFiles,
      matchedEntryNames: params.contextBookMatchedEntryNames,
      atDepthEntries: params.contextBookAtDepthEntries,
    }),
    ...(params.promptProfileContext?.profileName
      ? {
          promptProfiles: {
            profileName: params.promptProfileContext.profileName,
            sourcePath: params.promptProfileContext.sourcePath,
            promptChars: params.promptProfileContext.moduleEntries.reduce(
              (sum, entry) => sum + entry.chars,
              0,
            ),
            matchedModuleNames: params.promptProfileContext.matchedModuleNames,
            moduleEntries: params.promptProfileContext.moduleEntries,
            atDepthEntries: params.promptProfileContext.atDepthEntries.map((entry) => ({
              name: entry.name,
              depth: entry.depth,
              chars: entry.content.length,
            })),
          },
        }
      : {}),
    skills: {
      promptChars: params.skillsPrompt.length,
      entries: skillsEntries,
    },
    tools: {
      listChars: toolListChars,
      schemaChars: toolsSchemaChars,
      entries: toolsEntries,
    },
  };
}
