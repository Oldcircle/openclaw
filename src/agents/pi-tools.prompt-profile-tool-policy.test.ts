import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { createOpenClawCodingTools } from "./pi-tools.js";

describe("createOpenClawCodingTools prompt profile tool scope", () => {
  it("lets Prompt Profile allowlists narrow the final tool set", () => {
    const tools = createOpenClawCodingTools({
      senderIsOwner: true,
      promptProfileToolPolicy: {
        allow: ["group:web", "read"],
        deny: ["memory_get"],
      },
    });

    const names = new Set(tools.map((tool) => tool.name));
    expect(names.has("read")).toBe(true);
    expect(names.has("web_search")).toBe(true);
    expect(names.has("web_fetch")).toBe(true);
    expect(names.has("memory_get")).toBe(false);
    expect(names.has("exec")).toBe(false);
  });

  it("cannot use Prompt Profile scope to re-enable tools blocked by config policy", () => {
    const cfg: OpenClawConfig = {
      tools: {
        allow: ["read"],
      },
    };

    const tools = createOpenClawCodingTools({
      config: cfg,
      senderIsOwner: true,
      promptProfileToolPolicy: {
        allow: ["group:web", "read"],
      },
    });

    expect(tools.map((tool) => tool.name)).toEqual(["read"]);
  });
});
