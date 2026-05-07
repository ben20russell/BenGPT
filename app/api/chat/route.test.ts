/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { toUserFacingChatError } from "./error-mapper";
import { POST } from "./route";

describe("POST /api/chat Azure config validation", () => {
  it("returns 500 when AZURE_OPENAI_API_VERSION is missing", async () => {
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.cognitiveservices.azure.com/openai";
    process.env.AZURE_OPENAI_DEPLOYMENT = "ben-gpt-5.4";
    delete process.env.AZURE_OPENAI_API_VERSION;

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("AZURE_OPENAI_API_VERSION");
  });
});

describe("toUserFacingChatError", () => {
  it("returns API-key guidance for authentication failures", () => {
    const payload = toUserFacingChatError({
      status: 401,
      message: "Unauthorized",
    });

    expect(payload.error).toContain("authentication failed");
    expect(payload.recovery).toContain("AZURE_OPENAI_API_KEY");
  });

  it("falls back to generic guidance for non-auth errors", () => {
    const payload = toUserFacingChatError({
      status: 429,
      message: "Rate limited",
    });

    expect(payload.error).toContain("request failed");
    expect(payload.recovery).toContain("Azure OpenAI settings");
  });

  it("returns deployment guidance when deployment is not found", () => {
    const payload = toUserFacingChatError({
      status: 404,
      message: "The model deployment was not found",
    });

    expect(payload.error).toContain("deployment");
    expect(payload.recovery).toContain("AZURE_OPENAI_DEPLOYMENT");
  });

  it("returns API-version guidance when api-version is invalid", () => {
    const payload = toUserFacingChatError({
      status: 400,
      message: "Invalid api-version specified",
    });

    expect(payload.error).toContain("API version");
    expect(payload.recovery).toContain("AZURE_OPENAI_API_VERSION");
  });

  it("returns tool support guidance when web_search is unsupported", () => {
    const payload = toUserFacingChatError({
      status: 400,
      message: "web_search is not supported for this model",
    });

    expect(payload.error).toContain("model/tool");
    expect(payload.recovery).toContain("thinking");
  });
});
