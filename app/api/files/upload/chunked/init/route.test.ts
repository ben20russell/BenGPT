/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_UPLOAD_ID_PREFIX, LOCAL_UPLOAD_STRATEGY } from "../local-store";

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
        purpose: "user_data",
      }),
    );
  });

  it("falls back to assistants purpose when user_data purpose is rejected", async () => {
    uploadsCreateSpy
      .mockRejectedValueOnce({
        status: 400,
        message: "Invalid value for purpose",
      })
      .mockResolvedValueOnce({
        id: "upload_456",
      });

    const req = new Request("http://localhost/api/files/upload/chunked/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "large-fallback.pdf",
        size: 8 * 1024 * 1024,
        type: "application/pdf",
      }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.uploadId).toBe("upload_456");
    expect(uploadsCreateSpy).toHaveBeenCalledTimes(2);
    expect(uploadsCreateSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        purpose: "user_data",
      }),
    );
    expect(uploadsCreateSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        purpose: "assistants",
      }),
    );
  });

  it("falls back when Azure marks purpose as invalid via param metadata", async () => {
    uploadsCreateSpy
      .mockRejectedValueOnce({
        status: 400,
        message: "Bad request payload",
        code: "invalid_value",
        param: "purpose",
      })
      .mockResolvedValueOnce({
        id: "upload_param_fallback_1",
      });

    const req = new Request("http://localhost/api/files/upload/chunked/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "param-fallback-large.pdf",
        size: 8 * 1024 * 1024,
        type: "application/pdf",
      }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.uploadId).toBe("upload_param_fallback_1");
    expect(uploadsCreateSpy).toHaveBeenCalledTimes(2);
    expect(uploadsCreateSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        purpose: "user_data",
      }),
    );
    expect(uploadsCreateSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        purpose: "assistants",
      }),
    );
  });

  it("falls back to local chunked upload session when uploads API init fails", async () => {
    uploadsCreateSpy.mockRejectedValueOnce({
      status: 500,
      message: "Uploads API unavailable",
    });

    const req = new Request("http://localhost/api/files/upload/chunked/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "large-service-outage.pdf",
        size: 6 * 1024 * 1024,
        type: "application/pdf",
      }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(String(json.uploadId || "")).toContain(LOCAL_UPLOAD_ID_PREFIX);
    expect(json.strategy).toBe(LOCAL_UPLOAD_STRATEGY);
  });
});
