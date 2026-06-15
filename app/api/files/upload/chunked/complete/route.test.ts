/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadsCompleteSpy = vi.fn();

vi.mock("openai", () => {
  class AzureOpenAI {
    uploads = {
      complete: uploadsCompleteSpy,
    };
  }

  return { AzureOpenAI };
});

import { POST } from "./route";

describe("POST /api/files/upload/chunked/complete", () => {
  beforeEach(() => {
    uploadsCompleteSpy.mockReset();
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
    process.env.AZURE_OPENAI_DEPLOYMENT = "ben-gpt-5.4";
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
});
