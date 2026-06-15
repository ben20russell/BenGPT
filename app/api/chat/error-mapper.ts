type ChatApiError = {
  status?: number;
  message?: string;
  error?: { message?: string; code?: string };
};

const AUTH_FAILURE_PATTERNS = ["unauthorized", "forbidden", "invalid api key", "access denied"] as const;
const FILE_NOT_READY_PATTERNS = ["file_input_not_ready", "giving up on waiting for file"] as const;
const DEPLOYMENT_FAILURE_PATTERNS = ["deployment", "not found"] as const;
const API_VERSION_FAILURE_PATTERNS = ["api-version", "api version"] as const;
const TOOLING_FAILURE_PATTERNS = ["web_search", "tool", "unsupported"] as const;

function toLowerText(value: string | undefined): string {
  return (value || "").toLowerCase();
}

function hasAnyPattern(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function getMergedErrorMessage(error: ChatApiError): string {
  return `${toLowerText(error.message)} ${toLowerText(error.error?.message)}`;
}

export function toUserFacingChatError(error: unknown): { error: string; recovery: string } {
  const maybe = error as ChatApiError;
  const status = maybe?.status;
  const merged = getMergedErrorMessage(maybe);
  const isAuthFailure = status === 401 || status === 403 || hasAnyPattern(merged, AUTH_FAILURE_PATTERNS);

  if (isAuthFailure) {
    return {
      error: "Azure OpenAI authentication failed. Check your API key and endpoint.",
      recovery:
        "Rotate or regenerate AZURE_OPENAI_API_KEY, verify AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_VERSION, then retry.",
    };
  }

  const isFileNotReadyFailure =
    hasAnyPattern(merged, FILE_NOT_READY_PATTERNS) || (merged.includes("file") && merged.includes("processing"));
  if (isFileNotReadyFailure) {
    return {
      error: "The uploaded file is still processing and could not be read yet.",
      recovery: "Wait a few seconds, then retry. If it still fails, re-upload the file and submit again.",
    };
  }

  const isFileProcessingFailure = merged.includes("file_input_failed");
  if (isFileProcessingFailure) {
    return {
      error: "The uploaded file could not be processed for parsing.",
      recovery: "Re-upload a clean, readable file and retry your request.",
    };
  }

  const isDeploymentFailure = status === 404 || hasAnyPattern(merged, DEPLOYMENT_FAILURE_PATTERNS);
  if (isDeploymentFailure) {
    return {
      error: "Azure OpenAI deployment was not found or is not available.",
      recovery:
        "Verify AZURE_OPENAI_DEPLOYMENT exactly matches your Azure deployment name (for example: ben-gpt-5.4).",
    };
  }

  const isApiVersionFailure = hasAnyPattern(merged, API_VERSION_FAILURE_PATTERNS);
  if (isApiVersionFailure) {
    return {
      error: "Azure OpenAI API version is invalid for this endpoint or model.",
      recovery:
        "Set AZURE_OPENAI_API_VERSION to the version shown in Azure for this deployment (for example: 2025-04-01-preview), then restart the server.",
    };
  }

  const isToolingFailure = hasAnyPattern(merged, TOOLING_FAILURE_PATTERNS);
  if (isToolingFailure) {
    return {
      error: "The selected model/tool combination is not supported by this deployment.",
      recovery:
        "Try mode 'thinking' first (no web_search), then confirm your deployment supports web search tools in Azure.",
    };
  }

  return {
    error: "The request failed. Please try again in a moment.",
    recovery: "Retry the request. If it keeps failing, verify your Azure OpenAI settings.",
  };
}
