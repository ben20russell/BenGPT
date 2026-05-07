/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const responsesCreateSpy = vi.fn();

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
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_DEPLOYMENT = "ben-gpt-5.5";
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
});
