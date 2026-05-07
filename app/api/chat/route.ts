import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

type SearchMode = "quick" | "agentic" | "deep";
type ForceMode = "auto" | "web" | "enterprise";

type ChatRequestBody = {
  query?: string;
  forceMode?: ForceMode | null;
  message?: string;
  searchMode?: SearchMode;
};

type UrlCitation = {
  type: "url_citation";
  url?: string;
  title?: string;
};

type Annotation = UrlCitation | { type: string; [key: string]: unknown };

type OutputContent = {
  annotations?: Annotation[];
};

type OutputItem = {
  content?: OutputContent[];
};

type ResponsesApi = {
  responses: {
    create: (params: {
      model: string | undefined;
      tools: Array<{ type: "web_search"; search_context_size: "high" | "medium" }>;
      input: string;
    }) => Promise<{
      output_text?: string;
      output?: OutputItem[];
    }>;
  };
};

function normalizeAzureEndpoint(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/openai$/i, "");
}

function getAzureConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  const endpoint = normalizeAzureEndpoint(
    process.env.AZURE_OPENAI_ENDPOINT ?? process.env.OPENAI_ENDPOINT,
  );
  const deployment =
    process.env.AZURE_OPENAI_DEPLOYMENT ??
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME ??
    process.env.AZURE_OPENAI_MODEL ??
    process.env.OPENAI_MODEL;

  const missing: string[] = [];
  if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
  if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
  if (!deployment) missing.push("AZURE_OPENAI_DEPLOYMENT");

  return { apiKey, endpoint, deployment, missing };
}

export async function POST(req: NextRequest) {
  try {
    console.log("[/api/chat] Received request");
    const body = (await req.json()) as ChatRequestBody;
    const query = body.query?.trim();
    const message = body.message?.trim();
    const text = query ?? message;
    const forceMode = body.forceMode ?? null;
    const searchMode =
      forceMode === "web"
        ? "deep"
        : forceMode === "enterprise"
          ? "agentic"
          : (body.searchMode ?? "quick");

    if (!text) {
      console.log("[/api/chat] Validation failed: missing message");
      return NextResponse.json(
        {
          error: "Please enter a message and try again.",
          recovery: "Type a question in the prompt and submit again.",
        },
        { status: 400 },
      );
    }

    const config = getAzureConfig();

    if (config.missing.length > 0) {
      console.log("[/api/chat] Missing Azure OpenAI environment variables", {
        missing: config.missing,
      });
      return NextResponse.json(
        {
          error: "Server configuration is incomplete.",
          recovery: `Set ${config.missing.join(", ")} in Vercel project settings for this deployment.`,
        },
        { status: 500 },
      );
    }

    console.log("[/api/chat] Calling Azure OpenAI responses.create", {
      searchMode,
      deployment: config.deployment,
    });

    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: `${config.endpoint}/openai/v1/`,
    });

    // Map modes: "quick" | "agentic" | "deep_research"
    const response = await (client as unknown as ResponsesApi).responses.create({
      model: config.deployment,
      tools: [
        {
          type: "web_search",
          // Optional: "quick" is fastest, "agentic" reasons over results,
          // "deep_research" does extended multi-step investigation
          search_context_size: searchMode === "deep" ? "high" : "medium",
        },
      ],
      input: text,
    });

    const citations =
      response.output
        ?.flatMap((outputItem) => outputItem.content ?? [])
        .flatMap((contentItem) => contentItem.annotations ?? [])
        .filter((annotation): annotation is UrlCitation => annotation.type === "url_citation") ?? [];

    console.log("[/api/chat] Completed successfully", {
      hasAnswer: Boolean(response.output_text),
      citationCount: citations.length,
    });

    return NextResponse.json({
      answer: response.output_text ?? "",
      citations,
    });
  } catch (error) {
    console.log("[/api/chat] Request failed", error);
    return NextResponse.json(
      {
        error: "The request failed. Please try again in a moment.",
        recovery: "Retry the request. If it keeps failing, verify your Azure OpenAI settings.",
      },
      { status: 500 },
    );
  }
}
