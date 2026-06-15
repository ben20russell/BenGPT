import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const LOCAL_UPLOAD_ID_PREFIX = "local_upload_";
export const LOCAL_UPLOAD_STRATEGY = "local_assembly";
export const SUPABASE_UPLOAD_ID_PREFIX = "supa_upload_";
export const SUPABASE_UPLOAD_STRATEGY = "supabase_assembly";

type ChunkedUploadStoreMode = "auto" | "local" | "supabase";
type ChunkedUploadStrategy = typeof LOCAL_UPLOAD_STRATEGY | typeof SUPABASE_UPLOAD_STRATEGY;

export type LocalChunkedUploadMeta = {
  uploadId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  strategy: ChunkedUploadStrategy;
};

const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/;
let supabaseClientCache: SupabaseClient | null | undefined;
let supabaseBucketReadyPromise: Promise<boolean> | null = null;

function getLocalChunkedUploadRoot() {
  const configured = (process.env.BEACON_CHUNKED_UPLOAD_DIR || "").trim();
  if (configured) return configured;
  return path.join(os.tmpdir(), "beacon-chunked-uploads");
}

function getChunkedUploadStoreMode(): ChunkedUploadStoreMode {
  const raw = (process.env.BEACON_CHUNKED_UPLOAD_STORE || "auto").trim().toLowerCase();
  if (raw === "local" || raw === "supabase" || raw === "auto") {
    return raw;
  }
  return "auto";
}

function getSupabaseChunkBucket() {
  const configured = (process.env.BEACON_CHUNKED_UPLOAD_SUPABASE_BUCKET || "").trim();
  return configured || "chunked-uploads";
}

function getSupabaseChunkClient(): SupabaseClient | null {
  const storeMode = getChunkedUploadStoreMode();
  if (storeMode === "local") {
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  if (typeof supabaseClientCache !== "undefined") {
    return supabaseClientCache;
  }

  supabaseClientCache = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  console.log("[chunked/local-store] Supabase chunk client initialized", {
    bucket: getSupabaseChunkBucket(),
  });
  return supabaseClientCache;
}

async function ensureSupabaseChunkBucket(client: SupabaseClient): Promise<boolean> {
  if (supabaseBucketReadyPromise) {
    return supabaseBucketReadyPromise;
  }

  const bucket = getSupabaseChunkBucket();
  supabaseBucketReadyPromise = (async () => {
    const existing = await client.storage.getBucket(bucket);
    if (!existing.error) {
      return true;
    }

    const message = String(existing.error.message || "").toLowerCase();
    const notFound = message.includes("not found") || message.includes("does not exist");
    if (!notFound) {
      console.log("[chunked/local-store] Failed to check Supabase chunk bucket", {
        bucket,
        error: existing.error,
      });
      return false;
    }

    const created = await client.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: "150MB",
    });
    if (created.error) {
      console.log("[chunked/local-store] Failed to create Supabase chunk bucket", {
        bucket,
        error: created.error,
      });
      return false;
    }

    console.log("[chunked/local-store] Created Supabase chunk bucket", {
      bucket,
    });
    return true;
  })();

  const ready = await supabaseBucketReadyPromise;
  if (!ready) {
    supabaseBucketReadyPromise = null;
  }
  return ready;
}

function assertSafeSegment(value: string, label: string) {
  if (!SAFE_SEGMENT_PATTERN.test(value)) {
    throw new Error(`Unsafe ${label} value: ${value}`);
  }
}

function getUploadDir(uploadId: string) {
  assertSafeSegment(uploadId, "uploadId");
  return path.join(getLocalChunkedUploadRoot(), uploadId);
}

function getMetaPath(uploadId: string) {
  return path.join(getUploadDir(uploadId), "meta.json");
}

function getPartsDir(uploadId: string) {
  return path.join(getUploadDir(uploadId), "parts");
}

function getPartPath(uploadId: string, partId: string) {
  assertSafeSegment(partId, "partId");
  return path.join(getPartsDir(uploadId), `${partId}.bin`);
}

function getSupabaseMetaPath(uploadId: string) {
  assertSafeSegment(uploadId, "uploadId");
  return `${uploadId}/meta.json`;
}

function getSupabasePartPath(uploadId: string, partId: string) {
  assertSafeSegment(uploadId, "uploadId");
  assertSafeSegment(partId, "partId");
  return `${uploadId}/parts/${partId}.bin`;
}

function isSupabaseChunkedUploadId(uploadId: string) {
  return uploadId.startsWith(SUPABASE_UPLOAD_ID_PREFIX);
}

export function isLocalChunkedUploadId(uploadId: string) {
  return uploadId.startsWith(LOCAL_UPLOAD_ID_PREFIX) || isSupabaseChunkedUploadId(uploadId);
}

export async function createLocalChunkedUploadSession(input: {
  filename: string;
  mimeType: string;
  size: number;
}): Promise<LocalChunkedUploadMeta> {
  const supabaseClient = getSupabaseChunkClient();
  if (supabaseClient) {
    const bucketReady = await ensureSupabaseChunkBucket(supabaseClient);
    if (bucketReady) {
      const uploadId = `${SUPABASE_UPLOAD_ID_PREFIX}${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      const meta: LocalChunkedUploadMeta = {
        uploadId,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        createdAt: new Date().toISOString(),
        strategy: SUPABASE_UPLOAD_STRATEGY,
      };

      const bucket = getSupabaseChunkBucket();
      const metaBlob = new Blob([JSON.stringify(meta)], {
        type: "application/json",
      });
      const uploaded = await supabaseClient.storage.from(bucket).upload(getSupabaseMetaPath(uploadId), metaBlob, {
        contentType: "application/json",
        upsert: true,
      });

      if (!uploaded.error) {
        console.log("[chunked/local-store] Created Supabase-backed chunked upload session", {
          uploadId,
          bucket,
          filename: meta.filename,
          mimeType: meta.mimeType,
          size: meta.size,
        });
        return meta;
      }

      console.log("[chunked/local-store] Failed to create Supabase-backed chunked upload session; falling back to local", {
        bucket,
        filename: input.filename,
        size: input.size,
        error: uploaded.error,
      });
    }
  }

  const localUploadId = `${LOCAL_UPLOAD_ID_PREFIX}${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const localMeta: LocalChunkedUploadMeta = {
    uploadId: localUploadId,
    filename: input.filename,
    mimeType: input.mimeType,
    size: input.size,
    createdAt: new Date().toISOString(),
    strategy: LOCAL_UPLOAD_STRATEGY,
  };

  const localUploadDir = getUploadDir(localUploadId);
  const localPartsDir = getPartsDir(localUploadId);
  await mkdir(localPartsDir, { recursive: true });
  await writeFile(getMetaPath(localUploadId), JSON.stringify(localMeta), "utf8");

  console.log("[chunked/local-store] Created local chunked upload session", {
    uploadId: localUploadId,
    uploadDir: localUploadDir,
    filename: localMeta.filename,
    mimeType: localMeta.mimeType,
    size: localMeta.size,
  });

  return localMeta;
}

export async function readLocalChunkedUploadSession(uploadId: string): Promise<LocalChunkedUploadMeta | null> {
  if (isSupabaseChunkedUploadId(uploadId)) {
    const supabaseClient = getSupabaseChunkClient();
    if (!supabaseClient) {
      console.log("[chunked/local-store] Supabase chunk client unavailable for Supabase upload id", {
        uploadId,
      });
      return null;
    }
    const bucketReady = await ensureSupabaseChunkBucket(supabaseClient);
    if (!bucketReady) {
      return null;
    }

    const bucket = getSupabaseChunkBucket();
    const downloaded = await supabaseClient.storage.from(bucket).download(getSupabaseMetaPath(uploadId));
    if (downloaded.error || !downloaded.data) {
      if (downloaded.error) {
        console.log("[chunked/local-store] Failed to read Supabase chunk meta", {
          uploadId,
          bucket,
          error: downloaded.error,
        });
      }
      return null;
    }

    try {
      const raw = await downloaded.data.text();
      const parsed = JSON.parse(raw) as LocalChunkedUploadMeta;
      if (!parsed || parsed.uploadId !== uploadId) return null;
      return parsed;
    } catch (error) {
      console.log("[chunked/local-store] Failed to parse Supabase chunk meta", {
        uploadId,
        bucket,
        error,
      });
      return null;
    }
  }

  try {
    const raw = await readFile(getMetaPath(uploadId), "utf8");
    const parsed = JSON.parse(raw) as LocalChunkedUploadMeta;
    if (!parsed || parsed.uploadId !== uploadId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeLocalChunkPart(input: {
  uploadId: string;
  part: File;
  partIndexRaw?: string;
}): Promise<{ partId: string; partIndex: number; bytes: number }> {
  const { uploadId, part, partIndexRaw } = input;
  if (!isLocalChunkedUploadId(uploadId)) {
    throw new Error(`Upload id is not a local chunked upload id: ${uploadId}`);
  }

  const meta = await readLocalChunkedUploadSession(uploadId);
  if (!meta) {
    throw new Error(`Local chunked upload session not found: ${uploadId}`);
  }

  if (isSupabaseChunkedUploadId(uploadId)) {
    const supabaseClient = getSupabaseChunkClient();
    if (!supabaseClient) {
      throw new Error(`Supabase chunk client unavailable for upload id: ${uploadId}`);
    }
    const bucketReady = await ensureSupabaseChunkBucket(supabaseClient);
    if (!bucketReady) {
      throw new Error(`Supabase chunk bucket unavailable for upload id: ${uploadId}`);
    }

    let partIndex = Number.parseInt(String(partIndexRaw || ""), 10);
    if (!Number.isFinite(partIndex) || partIndex < 0) {
      partIndex = 0;
    }

    const partId = `supa_part_${partIndex}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const bytes = new Uint8Array(await part.arrayBuffer());
    const bucket = getSupabaseChunkBucket();
    const uploaded = await supabaseClient.storage.from(bucket).upload(getSupabasePartPath(uploadId, partId), bytes, {
      contentType: "application/octet-stream",
      upsert: true,
    });
    if (uploaded.error) {
      throw new Error(`Failed to store Supabase chunk part: ${String(uploaded.error.message || uploaded.error)}`);
    }

    console.log("[chunked/local-store] Stored Supabase chunk part", {
      uploadId,
      bucket,
      partId,
      partIndex,
      bytes: bytes.byteLength,
      expectedTotalBytes: meta.size,
    });

    return {
      partId,
      partIndex,
      bytes: bytes.byteLength,
    };
  }

  let partIndex = Number.parseInt(String(partIndexRaw || ""), 10);
  if (!Number.isFinite(partIndex) || partIndex < 0) {
    const existing = await readdir(getPartsDir(uploadId)).catch(() => []);
    partIndex = existing.length;
  }

  const partId = `local_part_${partIndex}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const bytes = Buffer.from(await part.arrayBuffer());
  await writeFile(getPartPath(uploadId, partId), bytes);

  console.log("[chunked/local-store] Stored local part", {
    uploadId,
    partId,
    partIndex,
    bytes: bytes.length,
    expectedTotalBytes: meta.size,
  });

  return {
    partId,
    partIndex,
    bytes: bytes.length,
  };
}

export async function assembleLocalChunkedUpload(input: {
  uploadId: string;
  partIds: string[];
}): Promise<{ file: File; bytes: number; meta: LocalChunkedUploadMeta }> {
  const { uploadId, partIds } = input;
  const meta = await readLocalChunkedUploadSession(uploadId);
  if (!meta) {
    throw new Error(`Local chunked upload session not found: ${uploadId}`);
  }

  if (isSupabaseChunkedUploadId(uploadId)) {
    const supabaseClient = getSupabaseChunkClient();
    if (!supabaseClient) {
      throw new Error(`Supabase chunk client unavailable for upload id: ${uploadId}`);
    }
    const bucketReady = await ensureSupabaseChunkBucket(supabaseClient);
    if (!bucketReady) {
      throw new Error(`Supabase chunk bucket unavailable for upload id: ${uploadId}`);
    }

    const fileParts: ArrayBuffer[] = [];
    let totalBytes = 0;
    const bucket = getSupabaseChunkBucket();

    for (const partId of partIds) {
      const trimmedPartId = String(partId || "").trim();
      if (!trimmedPartId) {
        throw new Error("Supabase chunked upload complete payload included an empty part id.");
      }
      const downloaded = await supabaseClient.storage
        .from(bucket)
        .download(getSupabasePartPath(uploadId, trimmedPartId));
      if (downloaded.error || !downloaded.data) {
        throw new Error(
          `Failed to download Supabase chunk part ${trimmedPartId}: ${String(
            downloaded.error?.message || downloaded.error || "unknown error",
          )}`,
        );
      }
      const partBuffer = await downloaded.data.arrayBuffer();
      fileParts.push(partBuffer);
      totalBytes += partBuffer.byteLength;
    }

    if (totalBytes !== meta.size) {
      throw new Error(
        `Supabase chunked upload byte mismatch. Expected ${meta.size} bytes but assembled ${totalBytes} bytes.`,
      );
    }

    const file = new File(fileParts, meta.filename, {
      type: meta.mimeType || "application/octet-stream",
    });

    console.log("[chunked/local-store] Assembled Supabase chunked upload", {
      uploadId,
      bucket,
      filename: meta.filename,
      mimeType: meta.mimeType,
      partCount: partIds.length,
      totalBytes,
    });

    return {
      file,
      bytes: totalBytes,
      meta,
    };
  }

  const fileParts: ArrayBuffer[] = [];
  let totalBytes = 0;

  for (const partId of partIds) {
    const trimmedPartId = String(partId || "").trim();
    if (!trimmedPartId) {
      throw new Error("Local chunked upload complete payload included an empty part id.");
    }
    const bytes = await readFile(getPartPath(uploadId, trimmedPartId));
    // Copy into a plain Uint8Array so File constructor receives browser-compatible blob parts.
    const filePartBuffer = new ArrayBuffer(bytes.byteLength);
    const filePartBytes = new Uint8Array(filePartBuffer);
    filePartBytes.set(bytes);
    fileParts.push(filePartBuffer);
    totalBytes += bytes.length;
  }

  if (totalBytes !== meta.size) {
    throw new Error(
      `Local chunked upload byte mismatch. Expected ${meta.size} bytes but assembled ${totalBytes} bytes.`,
    );
  }

  const file = new File(fileParts, meta.filename, {
    type: meta.mimeType || "application/octet-stream",
  });

  console.log("[chunked/local-store] Assembled local chunked upload", {
    uploadId,
    filename: meta.filename,
    mimeType: meta.mimeType,
    partCount: partIds.length,
    totalBytes,
  });

  return {
    file,
    bytes: totalBytes,
    meta,
  };
}

export async function clearLocalChunkedUpload(uploadId: string) {
  if (isSupabaseChunkedUploadId(uploadId)) {
    const supabaseClient = getSupabaseChunkClient();
    if (!supabaseClient) {
      console.log("[chunked/local-store] Supabase chunk client unavailable while clearing upload artifacts", {
        uploadId,
      });
      return;
    }
    const bucketReady = await ensureSupabaseChunkBucket(supabaseClient);
    if (!bucketReady) {
      return;
    }

    const bucket = getSupabaseChunkBucket();
    const partsList = await supabaseClient.storage.from(bucket).list(`${uploadId}/parts`, {
      limit: 1000,
      offset: 0,
    });
    const partPaths = (partsList.data || [])
      .filter((entry) => entry && typeof entry.name === "string" && entry.name.trim().length > 0)
      .map((entry) => `${uploadId}/parts/${entry.name}`);
    const pathsToRemove = [getSupabaseMetaPath(uploadId), ...partPaths];

    const removed = await supabaseClient.storage.from(bucket).remove(pathsToRemove);
    if (removed.error) {
      console.log("[chunked/local-store] Failed to clear Supabase chunked upload artifacts", {
        uploadId,
        bucket,
        pathsToRemoveCount: pathsToRemove.length,
        error: removed.error,
      });
      return;
    }

    console.log("[chunked/local-store] Cleared Supabase chunked upload artifacts", {
      uploadId,
      bucket,
      pathsToRemoveCount: pathsToRemove.length,
    });
    return;
  }

  const uploadDir = getUploadDir(uploadId);
  await rm(uploadDir, { recursive: true, force: true });
  console.log("[chunked/local-store] Cleared local chunked upload artifacts", {
    uploadId,
    uploadDir,
  });
}
