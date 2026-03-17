import { describe, expect, it } from "vitest";
import { buildContextReply } from "./commands-context-report.js";
import type { HandleCommandsParams } from "./commands-types.js";

function makeParams(
  commandBodyNormalized: string,
  truncated: boolean,
  options?: {
    omitBootstrapLimits?: boolean;
    includeContextBooks?: boolean;
    includePromptProfile?: boolean;
  },
): HandleCommandsParams {
  return {
    command: {
      commandBodyNormalized,
      channel: "telegram",
      senderIsOwner: true,
    },
    sessionKey: "agent:default:main",
    workspaceDir: "/tmp/workspace",
    contextTokens: null,
    provider: "openai",
    model: "gpt-5",
    elevated: { allowed: false },
    resolvedThinkLevel: "off",
    resolvedReasoningLevel: "off",
    sessionEntry: {
      totalTokens: 123,
      inputTokens: 100,
      outputTokens: 23,
      systemPromptReport: {
        source: "run",
        generatedAt: Date.now(),
        workspaceDir: "/tmp/workspace",
        bootstrapMaxChars: options?.omitBootstrapLimits ? undefined : 20_000,
        bootstrapTotalMaxChars: options?.omitBootstrapLimits ? undefined : 150_000,
        sandbox: { mode: "off", sandboxed: false },
        systemPrompt: {
          chars: 1_000,
          projectContextChars: 500,
          nonProjectContextChars: 500,
        },
        injectedWorkspaceFiles: [
          {
            name: "AGENTS.md",
            path: "/tmp/workspace/AGENTS.md",
            missing: false,
            rawChars: truncated ? 200_000 : 10_000,
            injectedChars: truncated ? 20_000 : 10_000,
            truncated,
          },
        ],
        contextBooks: options?.includeContextBooks
          ? {
              projectContextChars: 123,
              projectContextEntries: [
                {
                  name: "Research policy",
                  path: "/tmp/workspace/context-books/research.yaml#research-policy",
                  rawChars: 123,
                  injectedChars: 123,
                  truncated: false,
                },
              ],
              matchedEntryNames: ["Research policy", "Tail reminder"],
              atDepthEntries: [{ name: "Tail reminder", depth: 2, chars: 55 }],
            }
          : undefined,
        promptProfiles: options?.includePromptProfile
          ? {
              profileName: "Deep Think",
              sourcePath: "/tmp/workspace/prompt-profiles/deep-think.yaml",
              promptChars: 150,
              matchedModuleNames: ["Analysis frame", "Final answer", "Mid-history reminder"],
              moduleEntries: [
                {
                  name: "Analysis frame",
                  position: "after_context",
                  depth: 0,
                  chars: 50,
                },
                {
                  name: "Final answer",
                  position: "tail_reminder",
                  depth: 0,
                  chars: 60,
                },
                {
                  name: "Mid-history reminder",
                  position: "at_depth",
                  depth: 2,
                  chars: 40,
                },
              ],
              atDepthEntries: [{ name: "Deep Think / Mid-history reminder", depth: 2, chars: 40 }],
            }
          : undefined,
        skills: {
          promptChars: 10,
          entries: [{ name: "checks", blockChars: 10 }],
        },
        tools: {
          listChars: 10,
          schemaChars: 20,
          entries: [{ name: "read", summaryChars: 10, schemaChars: 20, propertiesCount: 1 }],
        },
      },
    },
    cfg: {},
    ctx: {},
    commandBody: "",
    commandArgs: [],
    resolvedElevatedLevel: "off",
  } as unknown as HandleCommandsParams;
}

describe("buildContextReply", () => {
  it("shows bootstrap truncation warning in list output when context exceeds configured limits", async () => {
    const result = await buildContextReply(makeParams("/context list", true));
    expect(result.text).toContain("Bootstrap max/total: 150,000 chars");
    expect(result.text).toContain("⚠ Bootstrap context is over configured limits");
    expect(result.text).toContain("Causes: 1 file(s) exceeded max/file.");
  });

  it("does not show bootstrap truncation warning when there is no truncation", async () => {
    const result = await buildContextReply(makeParams("/context list", false));
    expect(result.text).not.toContain("Bootstrap context is over configured limits");
  });

  it("falls back to config defaults when legacy reports are missing bootstrap limits", async () => {
    const result = await buildContextReply(
      makeParams("/context list", false, {
        omitBootstrapLimits: true,
      }),
    );
    expect(result.text).toContain("Bootstrap max/file: 20,000 chars");
    expect(result.text).toContain("Bootstrap max/total: 150,000 chars");
    expect(result.text).not.toContain("Bootstrap max/file: ? chars");
  });

  it("shows Context Book summaries in detail output when present", async () => {
    const result = await buildContextReply(
      makeParams("/context detail", false, {
        includeContextBooks: true,
      }),
    );
    expect(result.text).toContain("Context Books (Project Context): 1 entries");
    expect(result.text).toContain("Last run matched Context Books: Research policy, Tail reminder");
    expect(result.text).toContain("Top Context Books (Project Context):");
    expect(result.text).toContain("Last run at_depth Context Books:");
    expect(result.text).toContain("Tail reminder: depth=2");
  });

  it("shows Prompt Profile summaries in detail output when present", async () => {
    const result = await buildContextReply(
      makeParams("/context detail", false, {
        includePromptProfile: true,
      }),
    );
    expect(result.text).toContain("Prompt Profile: Deep Think");
    expect(result.text).toContain(
      "Active Prompt Profile modules: Analysis frame, Final answer, Mid-history reminder",
    );
    expect(result.text).toContain("Prompt Profile modules:");
    expect(result.text).toContain("Prompt Profile at_depth modules:");
    expect(result.text).toContain("Deep Think / Mid-history reminder: depth=2");
  });
});
