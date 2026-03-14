import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

describe("trace-viewer plugin", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("registers hooks and HTTP route", async () => {
    const on = vi.fn();
    const registerHttpRoute = vi.fn();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    plugin.register?.({
      logger,
      pluginConfig: {},
      config: {},
      on,
      registerHttpRoute,
    } as never);

    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/plugins/trace-viewer",
        auth: "plugin",
        match: "prefix",
      }),
    );
    expect(on).toHaveBeenCalledWith("before_prompt_build", expect.any(Function));
    expect(on).toHaveBeenCalledWith("llm_input", expect.any(Function));
    expect(on).toHaveBeenCalledWith("llm_output", expect.any(Function));
    expect(on).toHaveBeenCalledWith("before_tool_call", expect.any(Function));
    expect(on).toHaveBeenCalledWith("after_tool_call", expect.any(Function));
    expect(on).toHaveBeenCalledWith("agent_end", expect.any(Function));
  });

  it("uses the default traces root directory", async () => {
    const registerHttpRoute = vi.fn();
    const on = vi.fn();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-viewer-home-"));

    vi.spyOn(os, "homedir").mockReturnValue(homeDir);

    plugin.register?.({
      logger,
      pluginConfig: {},
      config: {},
      on,
      registerHttpRoute,
    } as never);

    const handler = registerHttpRoute.mock.calls[0]?.[0]?.handler;
    expect(typeof handler).toBe("function");
  });
});
