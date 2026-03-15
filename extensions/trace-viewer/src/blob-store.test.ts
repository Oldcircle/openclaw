import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BlobStore } from "./blob-store.js";

describe("BlobStore", () => {
  it("putSync returns consistent SHA-256 hash", () => {
    const dir = path.join(os.tmpdir(), `blob-test-${Date.now()}`);
    const store = new BlobStore(dir);
    const content = "hello world";
    const hash = store.putSync(content);
    const expected = crypto.createHash("sha256").update(content).digest("hex");
    expect(hash).toBe(expected);

    // Same content returns same hash
    expect(store.putSync(content)).toBe(hash);
  });

  it("flushPending writes blobs to disk in sharded directories", async () => {
    const dir = path.join(os.tmpdir(), `blob-test-${Date.now()}`);
    const store = new BlobStore(dir);
    const content = "test content for blob store";
    const hash = store.putSync(content);

    await store.flushPending();

    const filePath = path.join(dir, hash.slice(0, 2), `${hash}.txt`);
    const onDisk = await fs.readFile(filePath, "utf8");
    expect(onDisk).toBe(content);
  });

  it("get returns content from memory before flush", async () => {
    const dir = path.join(os.tmpdir(), `blob-test-${Date.now()}`);
    const store = new BlobStore(dir);
    const content = "buffered content";
    const hash = store.putSync(content);

    // Should be readable from memory before flush
    expect(await store.get(hash)).toBe(content);
  });

  it("get returns content from disk after flush", async () => {
    const dir = path.join(os.tmpdir(), `blob-test-${Date.now()}`);
    const store = new BlobStore(dir);
    const content = "persistent content";
    const hash = store.putSync(content);
    await store.flushPending();

    // Create a new store instance to verify disk read
    const store2 = new BlobStore(dir);
    expect(await store2.get(hash)).toBe(content);
  });

  it("get returns null for unknown hash", async () => {
    const dir = path.join(os.tmpdir(), `blob-test-${Date.now()}`);
    const store = new BlobStore(dir);
    expect(await store.get("0".repeat(64))).toBeNull();
  });

  it("deduplicates identical content", async () => {
    const dir = path.join(os.tmpdir(), `blob-test-${Date.now()}`);
    const store = new BlobStore(dir);
    const content = "repeated content";
    const hash1 = store.putSync(content);
    const hash2 = store.putSync(content);
    expect(hash1).toBe(hash2);

    await store.flushPending();

    // Only one file should exist
    const shardDir = path.join(dir, hash1.slice(0, 2));
    const files = await fs.readdir(shardDir);
    expect(files).toHaveLength(1);
  });

  it("handles multiple different blobs", async () => {
    const dir = path.join(os.tmpdir(), `blob-test-${Date.now()}`);
    const store = new BlobStore(dir);
    const h1 = store.putSync("content A");
    const h2 = store.putSync("content B");
    const h3 = store.putSync("content C");
    expect(new Set([h1, h2, h3]).size).toBe(3);

    await store.flushPending();

    expect(await store.get(h1)).toBe("content A");
    expect(await store.get(h2)).toBe("content B");
    expect(await store.get(h3)).toBe("content C");
  });
});
