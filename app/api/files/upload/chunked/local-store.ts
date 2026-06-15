import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const LOCAL_UPLOAD_ID_PREFIX = "local_upload_";
export const LOCAL_UPLOAD_STRATEGY = "local_assembly";

export type LocalChunkedUploadMeta = {
  uploadId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  strategy: typeof LOCAL_UPLOAD_STRATEGY;
};

const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/;

function getLocalChunkedUploadRoot() {
  const configured = (process.env.BEACON_CHUNKED_UPLOAD_DIR || "").trim();
  if (configured) return configured;
  return path.join(os.tmpdir(), "beacon-chunked-uploads");
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

export function isLocalChunkedUploadId(uploadId: string) {
  return uploadId.startsWith(LOCAL_UPLOAD_ID_PREFIX);
}

export async function createLocalChunkedUploadSession(input: {
  filename: string;
  mimeType: string;
  size: number;
}): Promise<LocalChunkedUploadMeta> {
  const uploadId = `${LOCAL_UPLOAD_ID_PREFIX}${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const meta: LocalChunkedUploadMeta = {
    uploadId,
    filename: input.filename,
    mimeType: input.mimeType,
    size: input.size,
    createdAt: new Date().toISOString(),
    strategy: LOCAL_UPLOAD_STRATEGY,
  };

  const uploadDir = getUploadDir(uploadId);
  const partsDir = getPartsDir(uploadId);
  await mkdir(partsDir, { recursive: true });
  await writeFile(getMetaPath(uploadId), JSON.stringify(meta), "utf8");

  console.log("[chunked/local-store] Created local chunked upload session", {
    uploadId,
    uploadDir,
    filename: meta.filename,
    mimeType: meta.mimeType,
    size: meta.size,
  });

  return meta;
}

export async function readLocalChunkedUploadSession(uploadId: string): Promise<LocalChunkedUploadMeta | null> {
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
  const uploadDir = getUploadDir(uploadId);
  await rm(uploadDir, { recursive: true, force: true });
  console.log("[chunked/local-store] Cleared local chunked upload artifacts", {
    uploadId,
    uploadDir,
  });
}
