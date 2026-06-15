import { NextRequest, NextResponse } from "next/server";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { AzureOpenAI } from "openai";
import { toUserFacingChatError } from "./error-mapper";

type SearchContextSize = "low" | "medium" | "high";
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
type TextVerbosity = "low" | "medium" | "high";

type SearchMode = "web_search" | "thinking" | "deep_research";

type UploadContextFile = {
  name?: string;
  type?: string;
  size?: number;
  contentKind?: "text" | "binary";
  contentText?: string;
  contentBase64?: string;
  fileId?: string;
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
  useMemory?: boolean;
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
  file_data?: string;
  file_id?: string | null;
  file_url?: string;
  filename?: string;
  detail?: "low" | "high";
};

type ResponseInputMessage = {
  type: "message";
  role: "user";
  content: Array<ResponseInputText | ResponseInputFile>;
};

type ResponsesApi = {
  responses: {
    create: (params: {
      model: string | undefined;
      instructions?: string;
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

type ChatResponsesRequest = Parameters<ResponsesApi["responses"]["create"]>[0];

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

const RESPONSE_FORMAT_INSTRUCTIONS = [
  "Use this exact response structure unless the user explicitly asks for a different format:",
  "",
  "## Direct answer",
  "- 1-3 sentences that answer the user directly.",
  "",
  "## Key points",
  "- Provide 3-6 short bullet points with the most important facts.",
  "",
  "## Details / rationale",
  "- Add only when needed for clarity.",
  "",
  "## Actionable next steps",
  "- Provide a numbered list of concrete next steps when helpful.",
  "",
  "## Assumptions / caveats",
  "- Include only when assumptions, uncertainty, or constraints exist.",
  "",
  "Writing requirements:",
  "- Use plain language and avoid fluff.",
  "- Be explicit about uncertainty.",
  "- Keep headings exactly as written above.",
].join("\n");

const DEFAULT_USE_MEMORY = true;
const MEMORY_HEADER = "--- MEMORY: CONTEXT FROM PAST SEARCHES ---";
const MEMORY_FILE_CANDIDATES = [
  path.resolve(process.cwd(), "AI_memory.txt"),
  path.resolve(process.cwd(), "..", "AI_memory.txt"),
];
const MEMORY_RETRIEVER_SCRIPT_CANDIDATES = [
  path.resolve(process.cwd(), "scripts", "retrieve_memory.py"),
  path.resolve(process.cwd(), "..", "my-gpt-search", "scripts", "retrieve_memory.py"),
  path.resolve(process.cwd(), "..", "scripts", "retrieve_memory.py"),
];

function normalizeBase64FileData(input: string, mimeType?: string): string {
  if (input.startsWith("data:")) {
    return input;
  }
  const safeMimeType = (mimeType || "application/octet-stream").trim() || "application/octet-stream";
  return `data:${safeMimeType};base64,${input}`;
}

function resolveUseMemory(raw: unknown): boolean {
  return typeof raw === "boolean" ? raw : DEFAULT_USE_MEMORY;
}

function runMemoryRetriever(scriptPath: string, userQuery: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      [scriptPath, userQuery],
      {
        maxBuffer: 1024 * 1024 * 2,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `memory retriever failed (${scriptPath}): ${error.message}${stderr ? ` | ${stderr}` : ""}`,
            ),
          );
          return;
        }
        resolve(stdout || "");
      },
    );
  });
}

async function get_relevant_memory(user_query: string): Promise<string[]> {
  for (const scriptPath of MEMORY_RETRIEVER_SCRIPT_CANDIDATES) {
    try {
      const raw = await runMemoryRetriever(scriptPath, user_query);
      const parsed = JSON.parse(raw) as { chunks?: unknown };
      const chunks = Array.isArray(parsed.chunks)
        ? parsed.chunks.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      if (chunks.length > 0) {
        console.log("[/api/chat] Retrieved relevant memory chunks", {
          scriptPath,
          chunkCount: chunks.length,
        });
      } else {
        console.log("[/api/chat] Memory retrieval returned no chunks", { scriptPath });
      }
      return chunks.slice(0, 3);
    } catch (error) {
      console.log("[/api/chat] Memory retrieval attempt failed", { scriptPath, error });
    }
  }
  return [];
}

async function buildInstructionsWithOptionalMemory(useMemory: boolean, userQuery: string | undefined): Promise<string> {
  if (!useMemory) {
    console.log("[/api/chat] Memory disabled for this request.");
    return RESPONSE_FORMAT_INSTRUCTIONS;
  }

  if (!userQuery?.trim()) {
    console.log("[/api/chat] Memory enabled but no user query text; skipping retrieval.");
    return RESPONSE_FORMAT_INSTRUCTIONS;
  }

  const relevantChunks = await get_relevant_memory(userQuery);
  if (relevantChunks.length === 0) {
    console.log("[/api/chat] Memory retrieval returned no usable chunks.");
    return RESPONSE_FORMAT_INSTRUCTIONS;
  }

  return [
    RESPONSE_FORMAT_INSTRUCTIONS,
    "",
    MEMORY_HEADER,
    "Use only these retrieved memory chunks when relevant to the current query. Do not assume unlisted memory.",
    ...relevantChunks.map((chunk, index) => `Memory chunk ${index + 1}:\n${chunk}`),
  ].join("\n\n");
}

async function getMemoryWritePath(): Promise<string> {
  for (const memoryPath of MEMORY_FILE_CANDIDATES) {
    try {
      await readFile(memoryPath, "utf8");
      return memoryPath;
    } catch {
      // Intentionally continue through candidates until one exists.
    }
  }
  return MEMORY_FILE_CANDIDATES[0];
}

function sanitizeMemoryLine(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

async function appendSearchToMemory(input: {
  searchMode: SearchMode;
  queryText: string;
  answerText: string;
}): Promise<void> {
  const { searchMode, queryText, answerText } = input;
  const memoryPath = await getMemoryWritePath();
  const timestamp = new Date().toISOString();
  const querySummary = sanitizeMemoryLine(queryText).slice(0, 700);
  const answerSummary = sanitizeMemoryLine(answerText).slice(0, 1400);

  if (!querySummary || !answerSummary) {
    console.log("[/api/chat] Skipping memory append due to missing summary text", {
      hasQuery: Boolean(querySummary),
      hasAnswer: Boolean(answerSummary),
    });
    return;
  }

  const entry = [
    "",
    `--- SEARCH MEMORY ENTRY | ${timestamp} ---`,
    `Mode: ${searchMode}`,
    `User search: ${querySummary}`,
    `Assistant answer: ${answerSummary}`,
  ].join("\n");

  try {
    await appendFile(memoryPath, entry, "utf8");
    console.log("[/api/chat] Search appended to memory", {
      memoryPath,
      queryChars: querySummary.length,
      answerChars: answerSummary.length,
      searchMode,
    });
  } catch (error) {
    console.log("[/api/chat] Failed to append search to memory", {
      memoryPath,
      error,
    });
  }
}

function parseSearchMode(rawMode: unknown): SearchMode {
  if (rawMode === "quick" || rawMode === "web_search" || rawMode === "thinking" || rawMode === "deep_research") {
    if (rawMode === "quick") {
      return "web_search";
    }
    return rawMode;
  }
  return "web_search";
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
    const useMemory = resolveUseMemory(body.useMemory);

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
      useMemory,
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
      let attachedByIdCount = 0;
      let attachedInlineBytesCount = 0;
      const unresolvedEntries: string[] = [];

      files.forEach((file, index) => {
        const safeName = file.name || `document-${index + 1}`;
        if (typeof file.fileId === "string" && file.fileId.trim().length > 0) {
          inputFiles.push({
            type: "input_file",
            file_id: file.fileId.trim(),
            filename: safeName,
            detail: "high",
          });
          attachedByIdCount += 1;
          return;
        }

        if (typeof file.contentBase64 === "string" && file.contentBase64.trim().length > 0) {
          inputFiles.push({
            type: "input_file",
            file_data: normalizeBase64FileData(file.contentBase64, file.type),
            filename: safeName,
            detail: "high",
          });
          attachedInlineBytesCount += 1;
          return;
        }

        if (typeof file.contentText === "string" && file.contentText.trim().length > 0) {
          unresolvedEntries.push(`File ${index + 1}: ${safeName}\nText content:\n${file.contentText}`);
          return;
        }

        unresolvedEntries.push(`File ${index + 1}: ${safeName}\nNote: ${file.note || "No usable file content was provided."}`);
      });

      if (attachedByIdCount + attachedInlineBytesCount > 0) {
        contextSections.push(
          `Uploaded files attached for parsing: ${attachedByIdCount + attachedInlineBytesCount}.`,
        );
      }
      if (unresolvedEntries.length > 0) {
        contextSections.push(`Additional file context:\n${unresolvedEntries.join("\n\n")}`);
      }
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
    const instructions = await buildInstructionsWithOptionalMemory(useMemory, text);
    const baseRequest: ChatResponsesRequest = {
      model: config.deployment,
      instructions,
      tools: preset.tools,
      tool_choice: preset.tool_choice,
      reasoning: preset.reasoning,
      text: preset.text,
      input: [inputMessage],
    };

    let response;
    try {
      response = await (client as unknown as ResponsesApi).responses.create(baseRequest);
    } catch (error) {
      const maybe = error as { status?: number; message?: string; error?: { message?: string } };
      const merged = `${(maybe?.message || "").toLowerCase()} ${(maybe?.error?.message || "").toLowerCase()}`;
      const shouldRetryMinimal =
        maybe?.status === 400 &&
        (merged.includes("reasoning") ||
          merged.includes("tool_choice") ||
          merged.includes("text") ||
          merged.includes("verbosity") ||
          merged.includes("unsupported") ||
          merged.includes("invalid"));

      if (!shouldRetryMinimal) {
        throw error;
      }

      console.log("[/api/chat] Retrying with minimal request shape after parameter rejection", {
        searchMode,
        status: maybe?.status,
        message: maybe?.message,
      });

      const fallbackRequest: ChatResponsesRequest = {
        model: config.deployment,
        instructions,
        input: [inputMessage],
      };
      if (preset.tools && searchMode !== "thinking") {
        fallbackRequest.tools = preset.tools;
      }

      response = await (client as unknown as ResponsesApi).responses.create(fallbackRequest);
    }

    const citations =
      response.output
        ?.flatMap((outputItem) => outputItem.content ?? [])
        .flatMap((contentItem) => contentItem.annotations ?? [])
        .filter((annotation): annotation is UrlCitation => annotation.type === "url_citation") ?? [];

    console.log("[/api/chat] Completed successfully", {
      hasAnswer: Boolean(response.output_text),
      citationCount: citations.length,
    });

    if (text && response.output_text) {
      await appendSearchToMemory({
        searchMode,
        queryText: text,
        answerText: response.output_text,
      });
    }

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
