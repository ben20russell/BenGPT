/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const responsesCreateSpy = vi.fn();
const { readFileMock, appendFileMock, execFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  appendFileMock: vi.fn(),
  execFileMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  appendFile: appendFileMock,
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("openai", () => {
  class AzureOpenAI {
    responses = {
      create: responsesCreateSpy,
    };
  }

  return { AzureOpenAI };
});

import { POST } from "./route";

describe("POST /api/chat request shape", () => {
  beforeEach(() => {
    responsesCreateSpy.mockReset();
    readFileMock.mockReset();
    appendFileMock.mockReset();
    execFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    appendFileMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout?: string) => void) => {
        callback(null, JSON.stringify({ chunks: [] }));
      },
    );
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_DEPLOYMENT = "ben-gpt-5.4";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
  });

  it("does not send input[0].id to the Responses API", async () => {
    responsesCreateSpy.mockResolvedValue({
      output_text: "ok",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "hello", mode: "thinking" }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(responsesCreateSpy).toHaveBeenCalledTimes(1);

    const firstCall = responsesCreateSpy.mock.calls[0]?.[0] as {
      input?: Array<Record<string, unknown>>;
    };
    expect(firstCall.input?.[0]).toBeDefined();
    expect(firstCall.input?.[0]).not.toHaveProperty("id");
  });

  it("applies requested reasoning intensity when provided by the client", async () => {
    responsesCreateSpy.mockResolvedValue({
      output_text: "ok",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "Be quick", mode: "thinking", reasoningIntensity: "low" }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(responsesCreateSpy).toHaveBeenCalledTimes(1);

    const firstCall = responsesCreateSpy.mock.calls[0]?.[0] as {
      reasoning?: { effort?: string };
    };
    expect(firstCall.reasoning?.effort).toBe("low");
  });

  it("caps max reasoning to high for non GPT-5 style deployments", async () => {
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-4o";
    responsesCreateSpy.mockResolvedValue({
      output_text: "ok",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "Think deeply", mode: "deep_research", reasoningIntensity: "xhigh" }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(responsesCreateSpy).toHaveBeenCalledTimes(1);

    const firstCall = responsesCreateSpy.mock.calls[0]?.[0] as {
      reasoning?: { effort?: string };
    };
    expect(firstCall.reasoning?.effort).toBe("high");
  });

  it("sends a formatting instruction that enforces a Claude-like response structure", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout?: string) => void) => {
        callback(
          null,
          JSON.stringify({
            chunks: [
              "Remember: Ben prefers concise, strategic answers.",
              "Prefer practical and direct recommendations.",
              "Use historical context only when relevant.",
            ],
          }),
        );
      },
    );
    responsesCreateSpy.mockResolvedValue({
      output_text: "ok",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "Explain this" }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(responsesCreateSpy).toHaveBeenCalledTimes(1);

    const firstCall = responsesCreateSpy.mock.calls[0]?.[0] as {
      instructions?: string;
    };

    expect(firstCall.instructions).toBeTruthy();
    expect(firstCall.instructions).toContain("Direct answer");
    expect(firstCall.instructions).toContain("Key points");
    expect(firstCall.instructions).toContain("Details / rationale");
    expect(firstCall.instructions).toContain("Actionable next steps");
    expect(firstCall.instructions).toContain("Assumptions / caveats");
    expect(firstCall.instructions).toContain("--- MEMORY: CONTEXT FROM PAST SEARCHES ---");
    expect(firstCall.instructions).toContain("Memory chunk 1");
  });

  it("does not append memory section when request sets useMemory to false", async () => {
    responsesCreateSpy.mockResolvedValue({
      output_text: "ok",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "Skip memory", useMemory: false }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(responsesCreateSpy).toHaveBeenCalledTimes(1);
    expect(appendFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).not.toHaveBeenCalled();

    const firstCall = responsesCreateSpy.mock.calls[0]?.[0] as {
      instructions?: string;
    };

    expect(firstCall.instructions).toBeTruthy();
    expect(firstCall.instructions).not.toContain("--- MEMORY: CONTEXT FROM PAST SEARCHES ---");
  });

  it("appends successful searches to AI_memory.txt", async () => {
    responsesCreateSpy.mockResolvedValue({
      output_text: "Fresh answer",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "Latest AI news", mode: "web_search" }),
    });

    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(appendFileMock).toHaveBeenCalledTimes(1);
    const [memoryPath, appended] = appendFileMock.mock.calls[0] as [string, string];
    expect(memoryPath).toContain("AI_memory.txt");
    expect(appended).toContain("User search: Latest AI news");
    expect(appended).toContain("Mode: web_search");
    expect(appended).toContain("Assistant answer: Fresh answer");
  });

  it("injects only top retrieved chunks into instructions", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout?: string) => void) => {
        callback(
          null,
          JSON.stringify({
            chunks: ["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"],
          }),
        );
      },
    );
    responsesCreateSpy.mockResolvedValue({
      output_text: "ok",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "Use memory safely" }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(responsesCreateSpy).toHaveBeenCalledTimes(1);

    const firstCall = responsesCreateSpy.mock.calls[0]?.[0] as {
      instructions?: string;
    };

    expect(firstCall.instructions).toBeTruthy();
    expect(firstCall.instructions).toContain("chunk-1");
    expect(firstCall.instructions).toContain("chunk-2");
    expect(firstCall.instructions).toContain("chunk-3");
    expect(firstCall.instructions).not.toContain("chunk-4");
  });

  it("falls back to base instructions when memory retrieval returns nothing", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout?: string) => void) => {
        callback(null, JSON.stringify({ chunks: [] }));
      },
    );
    responsesCreateSpy.mockResolvedValue({
      output_text: "Recovered answer",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "Handle big memory safely", useMemory: true }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(responsesCreateSpy).toHaveBeenCalledTimes(1);

    const firstCall = responsesCreateSpy.mock.calls[0]?.[0] as {
      instructions?: string;
    };

    expect(firstCall.instructions).not.toContain("--- MEMORY: CONTEXT FROM PAST SEARCHES ---");
  });

  it("uses input_file.file_id for binary files that were uploaded ahead of time", async () => {
    responsesCreateSpy.mockResolvedValue({
      output_text: "ok",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Analyze this uploaded PDF",
        files: [
          {
            name: "sample.pdf",
            type: "application/pdf",
            size: 12345,
            contentKind: "binary",
            fileId: "file_pdf_123",
            note: "Uploaded and attached as file_id.",
          },
        ],
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(responsesCreateSpy).toHaveBeenCalledTimes(1);

    const firstCall = responsesCreateSpy.mock.calls[0]?.[0] as {
      input?: Array<{ content?: Array<Record<string, unknown>> }>;
    };
    const firstMessage = firstCall.input?.[0];
    const inputFile = firstMessage?.content?.find((item) => item.type === "input_file");

    expect(inputFile).toBeDefined();
    expect(inputFile).toMatchObject({
      type: "input_file",
      file_id: "file_pdf_123",
      filename: "sample.pdf",
    });
    expect(inputFile).not.toHaveProperty("file_data");
  });

  it("normalizes raw base64 PDF bytes into a data URL when file_data is used", async () => {
    responsesCreateSpy.mockResolvedValue({
      output_text: "ok",
      output: [],
    });

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Analyze inline PDF bytes",
        files: [
          {
            name: "inline.pdf",
            type: "application/pdf",
            size: 4567,
            contentKind: "binary",
            contentBase64: "JVBERi0xLjQKJ...",
          },
        ],
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(responsesCreateSpy).toHaveBeenCalledTimes(1);

    const firstCall = responsesCreateSpy.mock.calls[0]?.[0] as {
      input?: Array<{ content?: Array<Record<string, unknown>> }>;
    };
    const firstMessage = firstCall.input?.[0];
    const inputFile = firstMessage?.content?.find((item) => item.type === "input_file");

    expect(inputFile).toBeDefined();
    expect(inputFile).toMatchObject({
      type: "input_file",
      filename: "inline.pdf",
    });
    expect(String(inputFile?.file_data || "")).toMatch(/^data:application\/pdf;base64,/);
  });
});
