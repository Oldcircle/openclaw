import { describe, expect, it } from "vitest";
import { AgentDefaultsSchema } from "./zod-schema.agent-defaults.js";

describe("contextBookPromptBudgetPercent schema", () => {
  it("accepts integer percentages from 0 to 100", () => {
    expect(() => AgentDefaultsSchema.parse({ contextBookPromptBudgetPercent: 0 })).not.toThrow();
    expect(() => AgentDefaultsSchema.parse({ contextBookPromptBudgetPercent: 25 })).not.toThrow();
    expect(() => AgentDefaultsSchema.parse({ contextBookPromptBudgetPercent: 100 })).not.toThrow();
  });

  it("rejects out-of-range or non-integer percentages", () => {
    expect(() => AgentDefaultsSchema.parse({ contextBookPromptBudgetPercent: -1 })).toThrow();
    expect(() => AgentDefaultsSchema.parse({ contextBookPromptBudgetPercent: 101 })).toThrow();
    expect(() => AgentDefaultsSchema.parse({ contextBookPromptBudgetPercent: 12.5 })).toThrow();
  });
});
