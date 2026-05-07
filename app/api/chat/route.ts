import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

type SearchMode = "quick" | "agentic" | "deep";
type ForceMode = "auto" | "web" | "enterprise";

type UploadContextFile = {
  name?: string;
  type?: string;
  size?: number;
  contentKind?: "text" | "binary" | "metadata_only";
  contentText?: string;
  contentBase64?: string;
  note?: string;
};

type GitSnippetContext = {
  label?: string;
  code?: string;
};

type HistoryTurnContext = {
  user?: string;
  assistant?: string;
  mode?: string;
};

type ChatRequestBody = {
  query?: string;
  forceMode?: ForceMode | null;
  message?: string;
  searchMode?: SearchMode;
  files?: UploadContextFile[];
  links?: string[];
  gitSnippets?: GitSnippetContext[];
  history?: HistoryTurnContext[];
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
    const files = Array.isArray(body.files) ? body.files : [];
    const links = Array.isArray(body.links) ? body.links : [];
    const gitSnippets = Array.isArray(body.gitSnippets) ? body.gitSnippets : [];
    const history = Array.isArray(body.history) ? body.history : [];
    const forceMode = body.forceMode ?? null;
    const searchMode =
      forceMode === "web"
        ? "deep"
        : forceMode === "enterprise"
          ? "agentic"
          : (body.searchMode ?? "quick");

    if (!text && files.length === 0 && links.length === 0 && gitSnippets.length === 0) {
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
          error: `Server configuration is incomplete. Missing: ${config.missing.join(", ")}`,
          recovery: `Set ${config.missing.join(", ")} in Vercel project settings for this deployment.`,
        },
        { status: 500 },
      );
    }

    console.log("[/api/chat] Calling Azure OpenAI responses.create", {
      searchMode,
      deployment: config.deployment,
      fileCount: files.length,
      linkCount: links.length,
      gitSnippetCount: gitSnippets.length,
      historyTurnCount: history.length,
    });

    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: `${config.endpoint}/openai/v1/`,
    });

    const contextSections: string[] = [];

    if (history.length > 0) {
      const trimmedHistory = history.slice(-8).map((turn, index) => {
        const userText = (turn.user || "").trim().slice(0, 1400);
        const assistantText = (turn.assistant || "").trim().slice(0, 1800);
        const mode = (turn.mode || "auto").trim();
        return [
          `Turn ${index + 1} (${mode})`,
          `User: ${userText || "(empty)"}`,
          `Assistant: ${assistantText || "(empty)"}`,
        ].join("\n");
      });
      contextSections.push(`Conversation history:\n${trimmedHistory.join("\n\n")}`);
    }

    if (files.length > 0) {
      const fileEntries = files.map((file, index) => {
        const header = [
          `File ${index + 1}: ${file.name || "untitled"}`,
          `type=${file.type || "unknown"}`,
          `size=${typeof file.size === "number" ? file.size : 0} bytes`,
          `kind=${file.contentKind || "metadata_only"}`,
        ].join(" | ");

        if (file.contentKind === "text" && file.contentText) {
          return `${header}\nText content:\n${file.contentText}`;
        }
        if (file.contentKind === "binary" && file.contentBase64) {
          return `${header}\nBase64 content:\n${file.contentBase64}`;
        }
        return `${header}\nNote: ${file.note || "No inline content provided."}`;
      });
      contextSections.push(`Uploaded files:\n${fileEntries.join("\n\n")}`);
    }

    if (links.length > 0) {
      contextSections.push(`Links to consider:\n${links.map((link) => `- ${link}`).join("\n")}`);
    }

    if (gitSnippets.length > 0) {
      const snippetEntries = gitSnippets.map((snippet, index) => {
        const label = snippet.label?.trim() || `snippet-${index + 1}`;
        const code = snippet.code?.trim() || "";
        return `Git snippet ${index + 1}: ${label}\n\`\`\`\n${code}\n\`\`\``;
      });
      contextSections.push(`Git code context:\n${snippetEntries.join("\n\n")}`);
    }

    const composedInput = [`User request:\n${text || "Analyze and summarize the provided context."}`, ...contextSections].join(
      "\n\n",
    );

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
      input: composedInput,
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
