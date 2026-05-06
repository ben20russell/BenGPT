import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

type SearchMode = "quick" | "agentic" | "deep";

type ChatRequestBody = {
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

const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}openai/v1/`,
});

export async function POST(req: NextRequest) {
  try {
    console.log("[/api/chat] Received request");
    const body = (await req.json()) as ChatRequestBody;
    const message = body.message?.trim();
    const searchMode = body.searchMode ?? "quick";

    if (!message) {
      console.log("[/api/chat] Validation failed: missing message");
      return NextResponse.json(
        {
          error: "Please enter a message and try again.",
          recovery: "Type a question in the prompt and submit again.",
        },
        { status: 400 },
      );
    }

    if (
      !process.env.AZURE_OPENAI_API_KEY ||
      !process.env.AZURE_OPENAI_ENDPOINT ||
      !process.env.AZURE_OPENAI_DEPLOYMENT
    ) {
      console.log("[/api/chat] Missing Azure OpenAI environment variables");
      return NextResponse.json(
        {
          error: "Server configuration is incomplete.",
          recovery:
            "Set AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_DEPLOYMENT in Vercel project settings.",
        },
        { status: 500 },
      );
    }

    console.log("[/api/chat] Calling Azure OpenAI responses.create", {
      searchMode,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    });

    // Map modes: "quick" | "agentic" | "deep_research"
    const response = await (client as unknown as ResponsesApi).responses.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT,
      tools: [
        {
          type: "web_search",
          // Optional: "quick" is fastest, "agentic" reasons over results,
          // "deep_research" does extended multi-step investigation
          search_context_size: searchMode === "deep" ? "high" : "medium",
        },
      ],
      input: message,
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
