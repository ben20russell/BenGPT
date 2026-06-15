/** @vitest-environment node */

import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocalChunkedUploadSession,
  readLocalChunkedUploadSession,
  writeLocalChunkPart,
} from "../local-store";

const uploadsCompleteSpy = vi.fn();
const filesCreateSpy = vi.fn();

vi.mock("openai", () => {
  class AzureOpenAI {
    files = {
      create: filesCreateSpy,
    };

    uploads = {
      complete: uploadsCompleteSpy,
    };
  }

  return { AzureOpenAI };
});

import { POST } from "./route";

describe("POST /api/files/upload/chunked/complete", () => {
  let localChunkedDir = "";

  beforeEach(async () => {
    uploadsCompleteSpy.mockReset();
    filesCreateSpy.mockReset();
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
    process.env.AZURE_OPENAI_DEPLOYMENT = "ben-gpt-5.4";
    localChunkedDir = await mkdtemp(path.join(os.tmpdir(), "chunked-complete-test-"));
    process.env.BEACON_CHUNKED_UPLOAD_DIR = localChunkedDir;
  });

  afterEach(async () => {
    delete process.env.BEACON_CHUNKED_UPLOAD_DIR;
    if (localChunkedDir) {
      await rm(localChunkedDir, { recursive: true, force: true });
    }
  });

  it("returns 400 when request payload is invalid", async () => {
    const req = new Request("http://localhost/api/files/upload/chunked/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: "", partIds: [] }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(String(json.error || "")).toContain("uploadId");
  });

  it("completes an upload and returns fileId", async () => {
    uploadsCompleteSpy.mockResolvedValue({
      id: "upload_123",
      file: {
        id: "file_pdf_123",
      },
    });

    const req = new Request("http://localhost/api/files/upload/chunked/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload_123",
        partIds: ["part_001", "part_002"],
      }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.fileId).toBe("file_pdf_123");
    expect(uploadsCompleteSpy).toHaveBeenCalledTimes(1);
    expect(uploadsCompleteSpy).toHaveBeenCalledWith("upload_123", {
      part_ids: ["part_001", "part_002"],
    });
  });

  it("completes local fallback uploads by assembling parts and creating a file", async () => {
    filesCreateSpy.mockResolvedValue({
      id: "file_local_pdf_123",
    });

    const session = await createLocalChunkedUploadSession({
      filename: "assembled.pdf",
      mimeType: "application/pdf",
      size: 4,
    });
    const writtenPart = await writeLocalChunkPart({
      uploadId: session.uploadId,
      part: new File([new Uint8Array([1, 2, 3, 4])], "chunk-0.bin"),
      partIndexRaw: "0",
    });

    const req = new Request("http://localhost/api/files/upload/chunked/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: session.uploadId,
        partIds: [writtenPart.partId],
      }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.fileId).toBe("file_local_pdf_123");
    expect(filesCreateSpy).toHaveBeenCalledTimes(1);
    expect(filesCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.any(File),
        purpose: "user_data",
      }),
    );
    expect(uploadsCompleteSpy).not.toHaveBeenCalled();
    expect(await readLocalChunkedUploadSession(session.uploadId)).toBeNull();
  });

  it("falls back to assistants purpose for local completion when user_data is rejected", async () => {
    filesCreateSpy
      .mockRejectedValueOnce({
        status: 400,
        message: "Invalid value for purpose",
      })
      .mockResolvedValueOnce({
        id: "file_local_pdf_456",
      });

    const session = await createLocalChunkedUploadSession({
      filename: "assembled-fallback.pdf",
      mimeType: "application/pdf",
      size: 4,
    });
    const writtenPart = await writeLocalChunkPart({
      uploadId: session.uploadId,
      part: new File([new Uint8Array([1, 2, 3, 4])], "chunk-0.bin"),
      partIndexRaw: "0",
    });

    const req = new Request("http://localhost/api/files/upload/chunked/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: session.uploadId,
        partIds: [writtenPart.partId],
      }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.fileId).toBe("file_local_pdf_456");
    expect(filesCreateSpy).toHaveBeenCalledTimes(2);
    expect(filesCreateSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        purpose: "user_data",
      }),
    );
    expect(filesCreateSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        purpose: "assistants",
      }),
    );
  });
});
