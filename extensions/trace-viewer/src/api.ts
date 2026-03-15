import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginLogger } from "openclaw/plugin-sdk";
import type { TraceCollector } from "./collector.js";
import type { TraceListQuery } from "./types.js";

type CreateTraceHttpHandlerParams = {
  collector: TraceCollector;
  logger?: PluginLogger;
};

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

export function createTraceHttpHandler(params: CreateTraceHttpHandlerParams) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = parseUrl(req.url);
    if (!url || !url.pathname.startsWith("/plugins/trace-viewer")) {
      return false;
    }

    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }

    try {
      if (url.pathname === "/plugins/trace-viewer/health") {
        if (!isGetLike(req.method)) {
          respondText(res, 405, "Method not allowed");
          return true;
        }
        respondJson(res, 200, await params.collector.health());
        return true;
      }

      if (url.pathname === "/plugins/trace-viewer/traces") {
        if (!isGetLike(req.method)) {
          respondText(res, 405, "Method not allowed");
          return true;
        }
        const query = parseListQuery(url);
        respondJson(res, 200, await params.collector.list(query));
        return true;
      }

      if (url.pathname.startsWith("/plugins/trace-viewer/blobs/")) {
        if (!isGetLike(req.method)) {
          respondText(res, 405, "Method not allowed");
          return true;
        }
        const hash = url.pathname.split("/").filter(Boolean)[3];
        if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
          respondText(res, 400, "Invalid blob hash");
          return true;
        }
        const content = await params.collector.getBlob(hash);
        if (content == null) {
          respondText(res, 404, "Blob not found");
          return true;
        }
        respondText(res, 200, content);
        return true;
      }

      if (url.pathname.startsWith("/plugins/trace-viewer/traces/")) {
        if (!isGetLike(req.method)) {
          respondText(res, 405, "Method not allowed");
          return true;
        }
        const traceId = url.pathname.split("/").filter(Boolean)[3];
        if (!traceId) {
          respondText(res, 400, "Missing trace id");
          return true;
        }
        const detail = await params.collector.get(traceId);
        if (!detail) {
          respondText(res, 404, "Trace not found");
          return true;
        }
        respondJson(res, 200, detail);
        return true;
      }
    } catch (error) {
      params.logger?.warn?.(`trace-viewer: api error: ${String(error)}`);
      respondJson(res, 500, {
        schemaVersion: 1,
        error: "internal_error",
      });
      return true;
    }

    respondText(res, 404, "Not found");
    return true;
  };
}

function parseListQuery(url: URL): TraceListQuery {
  const limitRaw = url.searchParams.get("limit");
  return {
    date: normalizeString(url.searchParams.get("date")),
    sessionKey: normalizeString(url.searchParams.get("sessionKey")),
    status: normalizeString(url.searchParams.get("status")) as TraceListQuery["status"],
    q: normalizeString(url.searchParams.get("q")),
    cursor: normalizeString(url.searchParams.get("cursor")),
    limit: limitRaw ? Number(limitRaw) : undefined,
  };
}

function parseUrl(raw?: string): URL | null {
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw, "http://127.0.0.1");
  } catch {
    return null;
  }
}

function normalizeString(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = normalizeString(
    typeof req.headers.origin === "string" ? req.headers.origin : null,
  );
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-methods", "GET,HEAD,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization");
}

function isGetLike(method: string | undefined): boolean {
  return method === "GET" || method === "HEAD";
}

function respondText(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-store, max-age=0");
  res.end(body);
}

function respondJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store, max-age=0");
  res.end(JSON.stringify(body));
}
