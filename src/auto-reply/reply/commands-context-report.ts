import { analyzeBootstrapBudget } from "../../agents/bootstrap-budget.js";
import {
  resolveBootstrapMaxChars,
  resolveBootstrapTotalMaxChars,
} from "../../agents/pi-embedded-helpers.js";
import { buildSystemPromptReport } from "../../agents/system-prompt-report.js";
import type { SessionSystemPromptReport } from "../../config/sessions/types.js";
import type { ReplyPayload } from "../types.js";
import { resolveCommandsSystemPromptBundle } from "./commands-system-prompt.js";
import type { HandleCommandsParams } from "./commands-types.js";

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCharsAndTokens(chars: number): string {
  return `${formatInt(chars)} chars (~${formatInt(estimateTokensFromChars(chars))} tok)`;
}

function parseContextArgs(commandBodyNormalized: string): string {
  if (commandBodyNormalized === "/context") {
    return "";
  }
  if (commandBodyNormalized.startsWith("/context ")) {
    return commandBodyNormalized.slice(8).trim();
  }
  return "";
}

function formatListTop(
  entries: Array<{ name: string; value: number }>,
  cap: number,
): { lines: string[]; omitted: number } {
  const sorted = [...entries].toSorted((a, b) => b.value - a.value);
  const top = sorted.slice(0, cap);
  const omitted = Math.max(0, sorted.length - top.length);
  const lines = top.map((e) => `- ${e.name}: ${formatCharsAndTokens(e.value)}`);
  return { lines, omitted };
}

async function resolveContextReport(
  params: HandleCommandsParams,
): Promise<SessionSystemPromptReport> {
  const existing = params.sessionEntry?.systemPromptReport;
  if (existing && existing.source === "run") {
    return existing;
  }

  const bootstrapMaxChars = resolveBootstrapMaxChars(params.cfg);
  const bootstrapTotalMaxChars = resolveBootstrapTotalMaxChars(params.cfg);
  const {
    systemPrompt,
    tools,
    skillsPrompt,
    bootstrapFiles,
    injectedFiles,
    promptProfileContext,
    sandboxRuntime,
  } = await resolveCommandsSystemPromptBundle(params);

  return buildSystemPromptReport({
    source: "estimate",
    generatedAt: Date.now(),
    sessionId: params.sessionEntry?.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.model,
    workspaceDir: params.workspaceDir,
    bootstrapMaxChars,
    bootstrapTotalMaxChars,
    sandbox: { mode: sandboxRuntime.mode, sandboxed: sandboxRuntime.sandboxed },
    systemPrompt,
    bootstrapFiles,
    injectedFiles,
    promptProfileContext,
    skillsPrompt,
    tools,
  });
}

export async function buildContextReply(params: HandleCommandsParams): Promise<ReplyPayload> {
  const args = parseContextArgs(params.command.commandBodyNormalized);
  const sub = args.split(/\s+/).filter(Boolean)[0]?.toLowerCase() ?? "";

  if (!sub || sub === "help") {
    return {
      text: [
        "🧠 /context",
        "",
        "What counts as context (high-level), plus a breakdown mode.",
        "",
        "Try:",
        "- /context list   (short breakdown)",
        "- /context detail (per-file + per-tool + per-skill + system prompt size)",
        "- /context json   (same, machine-readable)",
        "",
        "Inline shortcut = a command token inside a normal message (e.g. “hey /status”). It runs immediately (allowlisted senders only) and is stripped before the model sees the remaining text.",
      ].join("\n"),
    };
  }

  const report = await resolveContextReport(params);
  const session = {
    totalTokens: params.sessionEntry?.totalTokens ?? null,
    inputTokens: params.sessionEntry?.inputTokens ?? null,
    outputTokens: params.sessionEntry?.outputTokens ?? null,
    contextTokens: params.contextTokens ?? null,
  } as const;

  if (sub === "json") {
    return { text: JSON.stringify({ report, session }, null, 2) };
  }

  if (sub !== "list" && sub !== "show" && sub !== "detail" && sub !== "deep") {
    return {
      text: [
        "Unknown /context mode.",
        "Use: /context, /context list, /context detail, or /context json",
      ].join("\n"),
    };
  }

  const fileLines = report.injectedWorkspaceFiles.map((f) => {
    const status = f.missing ? "MISSING" : f.truncated ? "TRUNCATED" : "OK";
    const raw = f.missing ? "0" : formatCharsAndTokens(f.rawChars);
    const injected = f.missing ? "0" : formatCharsAndTokens(f.injectedChars);
    return `- ${f.name}: ${status} | raw ${raw} | injected ${injected}`;
  });

  const sandboxLine = `Sandbox: mode=${report.sandbox?.mode ?? "unknown"} sandboxed=${report.sandbox?.sandboxed ?? false}`;
  const toolSchemaLine = `Tool schemas (JSON): ${formatCharsAndTokens(report.tools.schemaChars)} (counts toward context; not shown as text)`;
  const toolListLine = `Tool list (system prompt text): ${formatCharsAndTokens(report.tools.listChars)}`;
  const skillNameSet = new Set(report.skills.entries.map((s) => s.name));
  const skillNames = Array.from(skillNameSet);
  const toolNames = report.tools.entries.map((t) => t.name);
  const formatNameList = (names: string[], cap: number) =>
    names.length <= cap
      ? names.join(", ")
      : `${names.slice(0, cap).join(", ")}, … (+${names.length - cap} more)`;
  const skillsLine = `Skills list (system prompt text): ${formatCharsAndTokens(report.skills.promptChars)} (${skillNameSet.size} skills)`;
  const skillsNamesLine = skillNameSet.size
    ? `Skills: ${formatNameList(skillNames, 20)}`
    : "Skills: (none)";
  const toolsNamesLine = toolNames.length
    ? `Tools: ${formatNameList(toolNames, 30)}`
    : "Tools: (none)";
  const systemPromptLine = `System prompt (${report.source}): ${formatCharsAndTokens(report.systemPrompt.chars)} (Project Context ${formatCharsAndTokens(report.systemPrompt.projectContextChars)})`;
  const contextBookProjectEntries = report.contextBooks?.projectContextEntries ?? [];
  const contextBookMatchedEntryNames = report.contextBooks?.matchedEntryNames ?? [];
  const contextBookAtDepthEntries = report.contextBooks?.atDepthEntries ?? [];
  const promptProfile = report.promptProfiles;
  const promptProfileMatchedModuleNames = promptProfile?.matchedModuleNames ?? [];
  const promptProfileAtDepthEntries = promptProfile?.atDepthEntries ?? [];
  const promptProfileToolAllow = promptProfile?.toolPolicy?.allow ?? [];
  const promptProfileToolDeny = promptProfile?.toolPolicy?.deny ?? [];
  const promptProfilePreferredTools = promptProfile?.preferredTools ?? [];
  const promptProfileOutputPreferences = promptProfile?.outputPreferences;
  const contextBooksLine = contextBookProjectEntries.length
    ? `Context Books (Project Context): ${contextBookProjectEntries.length} entries / ${formatCharsAndTokens(report.contextBooks?.projectContextChars ?? 0)}`
    : "Context Books (Project Context): none";
  const contextBookPromptBudgetLine =
    report.contextBooks && typeof report.contextBooks.promptBudgetChars === "number"
      ? `Last run Context Book prompt budget${
          typeof report.contextBooks.promptBudgetPercent === "number"
            ? ` (${formatInt(report.contextBooks.promptBudgetPercent)}%)`
            : ""
        }: ${formatCharsAndTokens(report.contextBooks.promptBudgetChars)} / used ${formatCharsAndTokens(report.contextBooks.promptChars ?? 0)}`
      : undefined;
  const contextBookSkippedLine =
    report.contextBooks?.skippedEntryNames && report.contextBooks.skippedEntryNames.length > 0
      ? `Last run skipped Context Books (budget): ${formatNameList(report.contextBooks.skippedEntryNames, 12)}`
      : undefined;
  const contextBookMatchedLine = contextBookMatchedEntryNames.length
    ? `Last run matched Context Books: ${formatNameList(contextBookMatchedEntryNames, 12)}`
    : report.source === "run"
      ? "Last run matched Context Books: none"
      : undefined;
  const contextBookAtDepthLine = contextBookAtDepthEntries.length
    ? `Last run at_depth entries: ${contextBookAtDepthEntries.map((entry) => `${entry.name} (depth=${entry.depth})`).join(", ")}`
    : report.source === "run" && contextBookMatchedEntryNames.length > 0
      ? "Last run at_depth entries: none"
      : undefined;
  const promptProfileLine = promptProfile?.profileName
    ? `Prompt Profile: ${promptProfile.profileName} / ${formatCharsAndTokens(promptProfile.promptChars)}`
    : "Prompt Profile: none";
  const promptProfileStreamParamsLine =
    promptProfile?.streamParams &&
    (typeof promptProfile.streamParams.temperature === "number" ||
      typeof promptProfile.streamParams.maxTokens === "number")
      ? `Prompt Profile stream params: ${[
          typeof promptProfile.streamParams.temperature === "number"
            ? `temperature=${promptProfile.streamParams.temperature}`
            : "",
          typeof promptProfile.streamParams.maxTokens === "number"
            ? `maxTokens=${promptProfile.streamParams.maxTokens}`
            : "",
        ]
          .filter(Boolean)
          .join(", ")}`
      : undefined;
  const promptProfileToolScopeLine =
    promptProfileToolAllow.length > 0 || promptProfileToolDeny.length > 0
      ? `Prompt Profile tool scope: ${[
          promptProfileToolAllow.length > 0 ? `allow=${promptProfileToolAllow.join(", ")}` : "",
          promptProfileToolDeny.length > 0 ? `deny=${promptProfileToolDeny.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ")}`
      : undefined;
  const promptProfilePreferredToolsLine = promptProfilePreferredTools.length
    ? `Prompt Profile preferred tools: ${formatNameList(promptProfilePreferredTools, 12)}`
    : undefined;
  const promptProfileOutputFormatLine = promptProfileOutputPreferences?.format
    ? `Prompt Profile output format: ${promptProfileOutputPreferences.format}`
    : undefined;
  const promptProfileOutputSectionsLine =
    promptProfileOutputPreferences && promptProfileOutputPreferences.sections.length > 0
      ? `Prompt Profile output sections: ${formatNameList(promptProfileOutputPreferences.sections, 12)}`
      : undefined;
  const promptProfileOutputStyleLine =
    promptProfileOutputPreferences && promptProfileOutputPreferences.style.length > 0
      ? `Prompt Profile output style: ${formatNameList(promptProfileOutputPreferences.style, 12)}`
      : undefined;
  const promptProfileOutputRulesLine =
    promptProfileOutputPreferences && promptProfileOutputPreferences.rules.length > 0
      ? `Prompt Profile output rules: ${formatNameList(promptProfileOutputPreferences.rules, 12)}`
      : undefined;
  const promptProfileRequireFinalTagLine = promptProfileOutputPreferences?.requireFinalTag
    ? "Prompt Profile output final tag: required"
    : undefined;
  const promptProfileReplyTagsLine = promptProfileOutputPreferences?.replyTags
    ? `Prompt Profile reply tags: ${promptProfileOutputPreferences.replyTags === "current_only" ? "current-only" : promptProfileOutputPreferences.replyTags === "allow_explicit" ? "allow-explicit" : "off"}`
    : undefined;
  const promptProfileMatchedLine = promptProfileMatchedModuleNames.length
    ? `Active Prompt Profile modules: ${formatNameList(promptProfileMatchedModuleNames, 12)}`
    : report.source === "run" && promptProfile?.profileName
      ? "Active Prompt Profile modules: none"
      : undefined;
  const promptProfileAtDepthLine = promptProfileAtDepthEntries.length
    ? `Prompt Profile at_depth modules: ${promptProfileAtDepthEntries.map((entry) => `${entry.name} (depth=${entry.depth})`).join(", ")}`
    : report.source === "run" && promptProfileMatchedModuleNames.length > 0
      ? "Prompt Profile at_depth modules: none"
      : undefined;
  const workspaceLabel = report.workspaceDir ?? params.workspaceDir;
  const bootstrapMaxChars =
    typeof report.bootstrapMaxChars === "number" &&
    Number.isFinite(report.bootstrapMaxChars) &&
    report.bootstrapMaxChars > 0
      ? report.bootstrapMaxChars
      : resolveBootstrapMaxChars(params.cfg);
  const bootstrapTotalMaxChars =
    typeof report.bootstrapTotalMaxChars === "number" &&
    Number.isFinite(report.bootstrapTotalMaxChars) &&
    report.bootstrapTotalMaxChars > 0
      ? report.bootstrapTotalMaxChars
      : resolveBootstrapTotalMaxChars(params.cfg);
  const bootstrapMaxLabel = `${formatInt(bootstrapMaxChars)} chars`;
  const bootstrapTotalLabel = `${formatInt(bootstrapTotalMaxChars)} chars`;
  const bootstrapAnalysis = analyzeBootstrapBudget({
    files: report.injectedWorkspaceFiles,
    bootstrapMaxChars,
    bootstrapTotalMaxChars,
  });
  const truncatedBootstrapFiles = bootstrapAnalysis.truncatedFiles;
  const truncationCauseCounts = truncatedBootstrapFiles.reduce(
    (acc, file) => {
      for (const cause of file.causes) {
        if (cause === "per-file-limit") {
          acc.perFile += 1;
        } else if (cause === "total-limit") {
          acc.total += 1;
        }
      }
      return acc;
    },
    { perFile: 0, total: 0 },
  );
  const truncationCauseParts = [
    truncationCauseCounts.perFile > 0
      ? `${truncationCauseCounts.perFile} file(s) exceeded max/file`
      : null,
    truncationCauseCounts.total > 0 ? `${truncationCauseCounts.total} file(s) hit max/total` : null,
  ].filter(Boolean);
  const bootstrapWarningLines =
    truncatedBootstrapFiles.length > 0
      ? [
          `⚠ Bootstrap context is over configured limits: ${truncatedBootstrapFiles.length} file(s) truncated (${formatInt(bootstrapAnalysis.totals.rawChars)} raw chars -> ${formatInt(bootstrapAnalysis.totals.injectedChars)} injected chars).`,
          ...(truncationCauseParts.length ? [`Causes: ${truncationCauseParts.join("; ")}.`] : []),
          "Tip: increase `agents.defaults.bootstrapMaxChars` and/or `agents.defaults.bootstrapTotalMaxChars` if this truncation is not intentional.",
        ]
      : [];

  const totalsLine =
    session.totalTokens != null
      ? `Session tokens (cached): ${formatInt(session.totalTokens)} total / ctx=${session.contextTokens ?? "?"}`
      : `Session tokens (cached): unknown / ctx=${session.contextTokens ?? "?"}`;
  const sharedContextLines = [
    `Workspace: ${workspaceLabel}`,
    `Bootstrap max/file: ${bootstrapMaxLabel}`,
    `Bootstrap max/total: ${bootstrapTotalLabel}`,
    sandboxLine,
    systemPromptLine,
    ...(bootstrapWarningLines.length ? ["", ...bootstrapWarningLines] : []),
    "",
    "Injected workspace files:",
    ...fileLines,
    "",
    contextBooksLine,
    ...(contextBookPromptBudgetLine ? [contextBookPromptBudgetLine] : []),
    ...(contextBookSkippedLine ? [contextBookSkippedLine] : []),
    ...(contextBookMatchedLine ? [contextBookMatchedLine] : []),
    ...(contextBookAtDepthLine ? [contextBookAtDepthLine] : []),
    "",
    promptProfileLine,
    ...(promptProfileStreamParamsLine ? [promptProfileStreamParamsLine] : []),
    ...(promptProfileToolScopeLine ? [promptProfileToolScopeLine] : []),
    ...(promptProfilePreferredToolsLine ? [promptProfilePreferredToolsLine] : []),
    ...(promptProfileOutputFormatLine ? [promptProfileOutputFormatLine] : []),
    ...(promptProfileOutputSectionsLine ? [promptProfileOutputSectionsLine] : []),
    ...(promptProfileOutputStyleLine ? [promptProfileOutputStyleLine] : []),
    ...(promptProfileOutputRulesLine ? [promptProfileOutputRulesLine] : []),
    ...(promptProfileRequireFinalTagLine ? [promptProfileRequireFinalTagLine] : []),
    ...(promptProfileReplyTagsLine ? [promptProfileReplyTagsLine] : []),
    ...(promptProfileMatchedLine ? [promptProfileMatchedLine] : []),
    ...(promptProfileAtDepthLine ? [promptProfileAtDepthLine] : []),
    "",
    skillsLine,
    skillsNamesLine,
  ];

  if (sub === "detail" || sub === "deep") {
    const perSkill = formatListTop(
      report.skills.entries.map((s) => ({ name: s.name, value: s.blockChars })),
      30,
    );
    const perToolSchema = formatListTop(
      report.tools.entries.map((t) => ({ name: t.name, value: t.schemaChars })),
      30,
    );
    const perToolSummary = formatListTop(
      report.tools.entries.map((t) => ({ name: t.name, value: t.summaryChars })),
      30,
    );
    const perContextBook = formatListTop(
      contextBookProjectEntries.map((entry) => ({ name: entry.name, value: entry.injectedChars })),
      30,
    );
    const perPromptProfileModule = formatListTop(
      (promptProfile?.moduleEntries ?? []).map((entry) => ({
        name: `${entry.name} (${entry.position})`,
        value: entry.chars,
      })),
      30,
    );
    const toolPropsLines = report.tools.entries
      .filter((t) => t.propertiesCount != null)
      .toSorted((a, b) => (b.propertiesCount ?? 0) - (a.propertiesCount ?? 0))
      .slice(0, 30)
      .map((t) => `- ${t.name}: ${t.propertiesCount} params`);
    const contextBookAtDepthLines = contextBookAtDepthEntries.map(
      (entry) => `- ${entry.name}: depth=${entry.depth} | ${formatCharsAndTokens(entry.chars)}`,
    );
    const promptProfileAtDepthLines = promptProfileAtDepthEntries.map(
      (entry) => `- ${entry.name}: depth=${entry.depth} | ${formatCharsAndTokens(entry.chars)}`,
    );

    return {
      text: [
        "🧠 Context breakdown (detailed)",
        ...sharedContextLines,
        ...(perContextBook.lines.length
          ? ["Top Context Books (Project Context):", ...perContextBook.lines]
          : []),
        ...(perContextBook.omitted ? [`… (+${perContextBook.omitted} more Context Books)`] : []),
        ...(contextBookAtDepthLines.length
          ? ["", "Last run at_depth Context Books:", ...contextBookAtDepthLines]
          : []),
        ...(perPromptProfileModule.lines.length
          ? ["", "Prompt Profile modules:", ...perPromptProfileModule.lines]
          : []),
        ...(perPromptProfileModule.omitted
          ? [`… (+${perPromptProfileModule.omitted} more Prompt Profile modules)`]
          : []),
        ...(promptProfileAtDepthLines.length
          ? ["", "Prompt Profile at_depth modules:", ...promptProfileAtDepthLines]
          : []),
        "",
        ...(perSkill.lines.length ? ["Top skills (prompt entry size):", ...perSkill.lines] : []),
        ...(perSkill.omitted ? [`… (+${perSkill.omitted} more skills)`] : []),
        "",
        toolListLine,
        toolSchemaLine,
        toolsNamesLine,
        "Top tools (schema size):",
        ...perToolSchema.lines,
        ...(perToolSchema.omitted ? [`… (+${perToolSchema.omitted} more tools)`] : []),
        "",
        "Top tools (summary text size):",
        ...perToolSummary.lines,
        ...(perToolSummary.omitted ? [`… (+${perToolSummary.omitted} more tools)`] : []),
        ...(toolPropsLines.length ? ["", "Tools (param count):", ...toolPropsLines] : []),
        "",
        totalsLine,
        "",
        "Inline shortcut: a command token inside normal text (e.g. “hey /status”) that runs immediately (allowlisted senders only) and is stripped before the model sees the remaining message.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return {
    text: [
      "🧠 Context breakdown",
      ...sharedContextLines,
      toolListLine,
      toolSchemaLine,
      toolsNamesLine,
      "",
      totalsLine,
      "",
      "Inline shortcut: a command token inside normal text (e.g. “hey /status”) that runs immediately (allowlisted senders only) and is stripped before the model sees the remaining message.",
    ].join("\n"),
  };
}
