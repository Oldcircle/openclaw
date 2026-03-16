import fs from "node:fs/promises";
import path from "node:path";
import type { PluginLogger } from "openclaw/plugin-sdk";
import type { TraceDetail, TraceListQuery, TraceListResponse, TraceSummary } from "./types.js";

type TraceStorageParams = {
  rootDir: string;
  logger?: PluginLogger;
};

type CursorPayload = {
  offset: number;
};

export class TraceStorage {
  private readonly rootDir: string;
  private readonly detailDir: string;
  private readonly indexDir: string;
  private readonly logger?: PluginLogger;
  private readyPromise: Promise<void> | null = null;

  constructor(params: TraceStorageParams) {
    this.rootDir = params.rootDir;
    this.detailDir = path.join(params.rootDir, "detail");
    this.indexDir = path.join(params.rootDir, "index");
    this.logger = params.logger;
  }

  async writeTrace(detail: TraceDetail): Promise<void> {
    await this.ensureReady();
    const detailPath = path.join(this.detailDir, `${detail.traceId}.json`);
    const summary = toSummary(detail);
    const day = toDayKey(detail.startedAt);
    const indexPath = path.join(this.indexDir, `${day}.jsonl`);

    await fs.writeFile(detailPath, JSON.stringify(detail, null, 2), "utf8");
    const existing = await readJsonlFile(indexPath);
    const filtered = existing.filter(
      (entry): entry is TraceSummary => entry.traceId !== detail.traceId,
    );
    filtered.push(summary);
    filtered.sort((a, b) => b.startedAt - a.startedAt);
    const body = filtered.map((entry) => JSON.stringify(entry)).join("\n");
    await fs.writeFile(indexPath, body ? `${body}\n` : "", "utf8");
  }

  async getTrace(traceId: string): Promise<TraceDetail | null> {
    await this.ensureReady();
    const detailPath = path.join(this.detailDir, `${traceId}.json`);
    try {
      const raw = await fs.readFile(detailPath, "utf8");
      return JSON.parse(raw) as TraceDetail;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async listTraces(query: TraceListQuery): Promise<TraceListResponse> {
    const summaries = await this.listMatchingTraces(query);
    const offset = decodeCursor(query.cursor);
    const limit = clampLimit(query.limit);
    const page = summaries.slice(offset, offset + limit);
    const nextCursor =
      offset + limit < summaries.length ? encodeCursor({ offset: offset + limit }) : undefined;

    return {
      schemaVersion: 1,
      items: page,
      nextCursor,
    };
  }

  async listMatchingTraces(query: TraceListQuery): Promise<TraceSummary[]> {
    await this.ensureReady();
    const files = query.date
      ? [`${query.date}.jsonl`]
      : (await fs.readdir(this.indexDir)).filter((entry) => entry.endsWith(".jsonl"));
    const summaries: TraceSummary[] = [];

    for (const fileName of files.sort().reverse()) {
      const items = await readJsonlFile(path.join(this.indexDir, fileName));
      for (const item of items) {
        if (query.sessionKey && item.sessionKey !== query.sessionKey) {
          continue;
        }
        if (query.status && item.status !== query.status) {
          continue;
        }
        if (query.q && !matchesQuery(item, query.q)) {
          continue;
        }
        summaries.push(item);
      }
    }

    summaries.sort((a, b) => b.startedAt - a.startedAt);
    return summaries;
  }

  async health(): Promise<{ activeIndexFiles: number }> {
    await this.ensureReady();
    try {
      const entries = await fs.readdir(this.indexDir);
      return { activeIndexFiles: entries.length };
    } catch (error) {
      this.logger?.warn?.(`trace-viewer: failed to read health state: ${String(error)}`);
      return { activeIndexFiles: 0 };
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = Promise.all([
        fs.mkdir(this.rootDir, { recursive: true }),
        fs.mkdir(this.detailDir, { recursive: true }),
        fs.mkdir(this.indexDir, { recursive: true }),
      ]).then(() => undefined);
    }
    await this.readyPromise;
  }
}

function toSummary(detail: TraceDetail): TraceSummary {
  const { steps: _steps, warnings: _warnings, ...summary } = detail;
  return summary;
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.floor(limit as number)));
}

function matchesQuery(item: TraceSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [
    item.traceId,
    item.runId,
    item.sessionKey,
    item.userMessage,
    item.finalReplyPreview,
    item.model,
    item.provider,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(needle));
}

function decodeCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const payload = JSON.parse(json) as CursorPayload;
    return Number.isFinite(payload.offset) && payload.offset >= 0 ? payload.offset : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

async function readJsonlFile(filePath: string): Promise<TraceSummary[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TraceSummary);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function toDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
