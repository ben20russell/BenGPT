/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const storageObjects = new Map<string, Uint8Array>();
const storageBuckets = new Set<string>();

function toBytes(value: unknown): Promise<Uint8Array> | Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Blob) {
    return value.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  return new Blob([value as BlobPart]).arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function getStorageKey(bucket: string, objectPath: string): string {
  return `${bucket}/${objectPath}`;
}

vi.mock("@supabase/supabase-js", () => {
  const createClient = vi.fn(() => {
    return {
      storage: {
        getBucket: vi.fn(async (bucket: string) => {
          if (storageBuckets.has(bucket)) {
            return { data: { id: bucket }, error: null };
          }
          return { data: null, error: { message: "Bucket not found" } };
        }),
        createBucket: vi.fn(async (bucket: string) => {
          storageBuckets.add(bucket);
          return { data: { name: bucket }, error: null };
        }),
        from: (bucket: string) => ({
          upload: async (objectPath: string, payload: unknown) => {
            const bytesOrPromise = toBytes(payload);
            const bytes = bytesOrPromise instanceof Promise ? await bytesOrPromise : bytesOrPromise;
            storageObjects.set(getStorageKey(bucket, objectPath), bytes);
            return { data: { path: objectPath }, error: null };
          },
          download: async (objectPath: string) => {
            const bytes = storageObjects.get(getStorageKey(bucket, objectPath));
            if (!bytes) {
              return { data: null, error: { message: "Object not found" } };
            }
            return { data: new Blob([bytes]), error: null };
          },
          list: async (prefix: string) => {
            const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
            const start = `${bucket}/${normalizedPrefix}`;
            const data = [...storageObjects.keys()]
              .filter((key) => key.startsWith(start))
              .map((key) => ({
                name: key.slice(start.length),
              }));
            return { data, error: null };
          },
          remove: async (objectPaths: string[]) => {
            objectPaths.forEach((objectPath) => {
              storageObjects.delete(getStorageKey(bucket, objectPath));
            });
            return { data: null, error: null };
          },
        }),
      },
    };
  });

  return {
    createClient,
  };
});

describe("chunked local store Supabase strategy", () => {
  beforeEach(() => {
    vi.resetModules();
    storageObjects.clear();
    storageBuckets.clear();
    process.env.BEACON_CHUNKED_UPLOAD_STORE = "supabase";
    process.env.BEACON_CHUNKED_UPLOAD_SUPABASE_BUCKET = "chunked-uploads-test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  it("creates, stores, assembles, and clears a Supabase-backed chunk session", async () => {
    const chunkStoreModule = await import("./local-store");
    const {
      SUPABASE_UPLOAD_ID_PREFIX,
      SUPABASE_UPLOAD_STRATEGY,
      createLocalChunkedUploadSession,
      writeLocalChunkPart,
      assembleLocalChunkedUpload,
      readLocalChunkedUploadSession,
      clearLocalChunkedUpload,
    } = chunkStoreModule;

    const session = await createLocalChunkedUploadSession({
      filename: "supabase-large.pdf",
      mimeType: "application/pdf",
      size: 4,
    });

    expect(session.strategy).toBe(SUPABASE_UPLOAD_STRATEGY);
    expect(session.uploadId.startsWith(SUPABASE_UPLOAD_ID_PREFIX)).toBe(true);

    const part = await writeLocalChunkPart({
      uploadId: session.uploadId,
      part: new File([new Uint8Array([1, 2, 3, 4])], "chunk-0.bin"),
      partIndexRaw: "0",
    });
    expect(part.bytes).toBe(4);

    const assembled = await assembleLocalChunkedUpload({
      uploadId: session.uploadId,
      partIds: [part.partId],
    });
    expect(assembled.bytes).toBe(4);
    expect(assembled.file.name).toBe("supabase-large.pdf");

    await clearLocalChunkedUpload(session.uploadId);
    expect(await readLocalChunkedUploadSession(session.uploadId)).toBeNull();
  });
});
