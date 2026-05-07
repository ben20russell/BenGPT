import { NextRequest, NextResponse } from "next/server";
import { AzureOpenAI } from "openai";
import { toUserFacingChatError } from "./error-mapper";

type SearchContextSize = "low" | "medium" | "high";
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
type TextVerbosity = "low" | "medium" | "high";

type SearchMode = "quick" | "web_search" | "thinking" | "deep_research";

type UploadContextFile = {
  name?: string;
  type?: string;
  size?: number;
  contentKind?: "text" | "binary";
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
  message?: string;
  mode?: SearchMode;
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

type ResponseInputText = {
  type: "input_text";
  text: string;
};

type ResponseInputFile = {
  type: "input_file";
  file_data: string;
  filename?: string;
  detail?: "low" | "high";
};

type ResponseInputMessage = {
  id: string;
  type: "message";
  role: "user";
  content: Array<ResponseInputText | ResponseInputFile>;
};

type ResponsesApi = {
  responses: {
    create: (params: {
      model: string | undefined;
      tools?: Array<{
        type: "web_search";
        search_context_size: SearchContextSize;
      }>;
      tool_choice?: "none" | "auto" | "required";
      reasoning?: {
        effort: ReasoningEffort;
      };
      text?: {
        verbosity: TextVerbosity;
      };
      input: ResponseInputMessage[];
    }) => Promise<{
      output_text?: string;
      output?: OutputItem[];
    }>;
  };
};

type SearchPreset = {
  tools?: Array<{
    type: "web_search";
    search_context_size: SearchContextSize;
  }>;
  tool_choice?: "none" | "auto" | "required";
  reasoning?: {
    effort: ReasoningEffort;
  };
  text?: {
    verbosity: TextVerbosity;
  };
};

const SEARCH_PRESETS: Record<SearchMode, SearchPreset> = {
  quick: {
    tools: [
      {
        type: "web_search",
        search_context_size: "low",
      },
    ],
    tool_choice: "auto",
    reasoning: {
      effort: "low",
    },
    text: {
      verbosity: "low",
    },
  },
  web_search: {
    tools: [
      {
        type: "web_search",
        search_context_size: "medium",
      },
    ],
    tool_choice: "required",
    reasoning: {
      effort: "medium",
    },
    text: {
      verbosity: "medium",
    },
  },
  thinking: {
    tool_choice: "none",
    reasoning: {
      effort: "high",
    },
    text: {
      verbosity: "medium",
    },
  },
  deep_research: {
    tools: [
      {
        type: "web_search",
        search_context_size: "high",
      },
    ],
    tool_choice: "required",
    reasoning: {
      effort: "xhigh",
    },
    text: {
      verbosity: "high",
    },
  },
};

function parseSearchMode(rawMode: unknown): SearchMode {
  if (rawMode === "quick" || rawMode === "web_search" || rawMode === "thinking" || rawMode === "deep_research") {
    return rawMode;
  }
  return "quick";
}

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
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? process.env.OPENAI_API_VERSION;
  const deployment =
    process.env.AZURE_OPENAI_DEPLOYMENT ??
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME ??
    process.env.AZURE_OPENAI_MODEL ??
    process.env.OPENAI_MODEL;

  const missing: string[] = [];
  if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
  if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
  if (!apiVersion) missing.push("AZURE_OPENAI_API_VERSION");
  if (!deployment) missing.push("AZURE_OPENAI_DEPLOYMENT");

  return { apiKey, endpoint, apiVersion, deployment, missing };
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
    const searchMode = parseSearchMode(body.mode);

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
      endpoint: config.endpoint,
      apiVersion: config.apiVersion,
      deployment: config.deployment,
      fileCount: files.length,
      linkCount: links.length,
      gitSnippetCount: gitSnippets.length,
      historyTurnCount: history.length,
    });

    const client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion,
    });

    const contextSections: string[] = [];

    if (history.length > 0) {
      const trimmedHistory = history.slice(-8).map((turn, index) => {
        const userText = (turn.user || "").trim().slice(0, 1400);
        const assistantText = (turn.assistant || "").trim().slice(0, 1800);
        const mode = (turn.mode || "quick").trim();
        return [
          `Turn ${index + 1} (${mode})`,
          `User: ${userText || "(empty)"}`,
          `Assistant: ${assistantText || "(empty)"}`,
        ].join("\n");
      });
      contextSections.push(`Conversation history:\n${trimmedHistory.join("\n\n")}`);
    }

    const inputFiles: ResponseInputFile[] = [];

    if (files.length > 0) {
      const fileEntries = files.map((file, index) => {
        const header = [
          `File ${index + 1}: ${file.name || "untitled"}`,
          `type=${file.type || "unknown"}`,
          `size=${typeof file.size === "number" ? file.size : 0} bytes`,
          `kind=${file.contentKind || "binary"}`,
        ].join(" | ");

        if (file.contentKind === "text" && file.contentText) {
          return `${header}\nText content:\n${file.contentText}`;
        }
        if (file.contentKind === "binary" && file.contentBase64) {
          inputFiles.push({
            type: "input_file",
            file_data: file.contentBase64,
            filename: file.name || `document-${index + 1}`,
            detail: "high",
          });
          return `${header}\nFile bytes included as structured file input for model parsing.`;
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

    const composedInput = [`User request:\n${text || "Analyze and summarize the provided context."}`, ...contextSections].join("\n\n");
    const inputMessage: ResponseInputMessage = {
      id: `msg-${Date.now()}`,
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: composedInput,
        },
        ...inputFiles,
      ],
    };

    const preset = SEARCH_PRESETS[searchMode];
    const response = await (client as unknown as ResponsesApi).responses.create({
      model: config.deployment,
      tools: preset.tools,
      tool_choice: preset.tool_choice,
      reasoning: preset.reasoning,
      text: preset.text,
      input: [inputMessage],
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
    const payload = toUserFacingChatError(error);
    return NextResponse.json(
      payload,
      { status: 500 },
    );
  }
}
