/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const filesCreateSpy = vi.fn();

vi.mock("openai", () => {
  class AzureOpenAI {
    files = {
      create: filesCreateSpy,
    };
  }

  return { AzureOpenAI };
});

import { POST } from "./route";

describe("POST /api/files/upload", () => {
  beforeEach(() => {
    filesCreateSpy.mockReset();
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
    process.env.AZURE_OPENAI_DEPLOYMENT = "ben-gpt-5.4";
  });

  it("returns 400 when file form field is missing", async () => {
    const req = new Request("http://localhost/api/files/upload", {
      method: "POST",
      body: new FormData(),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("file");
  });

  it("uploads a PDF to Files API and returns fileId", async () => {
    filesCreateSpy.mockResolvedValue({
      id: "file_pdf_uploaded_123",
    });

    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "invoice.pdf", {
        type: "application/pdf",
      }),
    );

    const req = new Request("http://localhost/api/files/upload", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.fileId).toBe("file_pdf_uploaded_123");
    expect(filesCreateSpy).toHaveBeenCalledTimes(1);
    expect(filesCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "assistants",
      }),
    );
  });
});
