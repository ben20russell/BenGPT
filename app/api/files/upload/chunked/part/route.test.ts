/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadsPartsCreateSpy = vi.fn();

vi.mock("openai", () => {
  class AzureOpenAI {
    uploads = {
      parts: {
        create: uploadsPartsCreateSpy,
      },
    };
  }

  return { AzureOpenAI };
});

import { POST } from "./route";

describe("POST /api/files/upload/chunked/part", () => {
  beforeEach(() => {
    uploadsPartsCreateSpy.mockReset();
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
    process.env.AZURE_OPENAI_DEPLOYMENT = "ben-gpt-5.4";
  });

  it("returns 400 when uploadId is missing", async () => {
    const formData = new FormData();
    formData.append("part", new File([new Uint8Array([1, 2, 3])], "part.bin"));
    const req = new Request("http://localhost/api/files/upload/chunked/part", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("uploads a chunk as a part and returns partId", async () => {
    uploadsPartsCreateSpy.mockResolvedValue({ id: "part_001" });

    const formData = new FormData();
    formData.append("uploadId", "upload_123");
    formData.append("part", new File([new Uint8Array([1, 2, 3, 4])], "chunk-0.bin"));
    const req = new Request("http://localhost/api/files/upload/chunked/part", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.partId).toBe("part_001");
    expect(uploadsPartsCreateSpy).toHaveBeenCalledTimes(1);
    expect(uploadsPartsCreateSpy).toHaveBeenCalledWith(
      "upload_123",
      expect.objectContaining({
        data: expect.any(File),
      }),
    );
  });
});
