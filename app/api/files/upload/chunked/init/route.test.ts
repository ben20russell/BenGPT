/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadsCreateSpy = vi.fn();

vi.mock("openai", () => {
  class AzureOpenAI {
    uploads = {
      create: uploadsCreateSpy,
    };
  }

  return { AzureOpenAI };
});

import { POST } from "./route";

describe("POST /api/files/upload/chunked/init", () => {
  beforeEach(() => {
    uploadsCreateSpy.mockReset();
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
    process.env.AZURE_OPENAI_DEPLOYMENT = "ben-gpt-5.4";
  });

  it("returns 400 when payload is invalid", async () => {
    const req = new Request("http://localhost/api/files/upload/chunked/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad.pdf", size: 0 }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(String(json.error || "")).toContain("size");
  });

  it("creates an uploads session and returns uploadId", async () => {
    uploadsCreateSpy.mockResolvedValue({ id: "upload_123" });

    const req = new Request("http://localhost/api/files/upload/chunked/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "large.pdf",
        size: 7 * 1024 * 1024,
        type: "application/pdf",
      }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.uploadId).toBe("upload_123");
    expect(uploadsCreateSpy).toHaveBeenCalledTimes(1);
    expect(uploadsCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: 7 * 1024 * 1024,
        filename: "large.pdf",
        mime_type: "application/pdf",
        purpose: "assistants",
      }),
    );
  });
});
