import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export class BlobStore {
  private readonly rootDir: string;
  private readonly pending = new Map<string, string>();
  private readonly known = new Set<string>();

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /** Compute SHA-256, buffer content in memory, return hash. */
  putSync(content: string): string {
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    if (!this.known.has(hash)) {
      this.pending.set(hash, content);
      this.known.add(hash);
    }
    return hash;
  }

  /** Write all pending blobs to disk. Call before persisting the trace. */
  async flushPending(): Promise<void> {
    if (this.pending.size === 0) return;

    const entries = Array.from(this.pending.entries());
    this.pending.clear();

    await Promise.all(
      entries.map(async ([hash, content]) => {
        const dir = path.join(this.rootDir, hash.slice(0, 2));
        const filePath = path.join(dir, `${hash}.txt`);
        try {
          await fsp.access(filePath);
          return; // already on disk
        } catch {
          // does not exist yet
        }
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(filePath, content, "utf8");
      }),
    );
  }

  /** Read a blob by hash. Returns null if not found. */
  async get(hash: string): Promise<string | null> {
    // Check in-memory buffer first
    const buffered = this.pending.get(hash);
    if (buffered != null) return buffered;

    const filePath = path.join(this.rootDir, hash.slice(0, 2), `${hash}.txt`);
    try {
      return await fsp.readFile(filePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Synchronous check: does the blob exist (in memory or on disk)? */
  has(hash: string): boolean {
    if (this.known.has(hash)) return true;
    const filePath = path.join(this.rootDir, hash.slice(0, 2), `${hash}.txt`);
    try {
      fs.accessSync(filePath);
      this.known.add(hash);
      return true;
    } catch {
      return false;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
