import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createTraceHttpHandler } from "./src/api.js";
import { BlobStore } from "./src/blob-store.js";
import { createTraceCollector } from "./src/collector.js";
import { TraceStorage } from "./src/storage.js";

const plugin = {
  id: "trace-viewer",
  name: "Trace Viewer",
  description: "Collect OpenClaw traces and expose a read-only viewer API.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const tracesRoot = path.join(os.homedir(), ".openclaw", "traces");
    const storage = new TraceStorage({
      rootDir: tracesRoot,
      logger: api.logger,
    });
    const blobStore = new BlobStore(path.join(tracesRoot, "blobs"));
    const collector = createTraceCollector({ storage, blobStore, logger: api.logger });

    api.registerHttpRoute({
      path: "/plugins/trace-viewer",
      auth: "plugin",
      match: "prefix",
      handler: createTraceHttpHandler({ collector, logger: api.logger }),
    });

    api.on("before_prompt_build", (event, ctx) => {
      collector.handlePromptBuild(event, ctx);
    });
    api.on("llm_input", (event, ctx) => {
      collector.handleLlmInput(event, ctx);
    });
    api.on("llm_output", (event, ctx) => {
      collector.handleLlmOutput(event, ctx);
    });
    api.on("before_tool_call", (event, ctx) => {
      collector.handleBeforeToolCall(event, ctx);
    });
    api.on("after_tool_call", (event, ctx) => {
      collector.handleAfterToolCall(event, ctx);
    });
    api.on("agent_end", (event, ctx) => {
      collector.handleAgentEnd(event, ctx);
    });
  },
};

export default plugin;
