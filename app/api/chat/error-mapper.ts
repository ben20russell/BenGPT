export function toUserFacingChatError(error: unknown): { error: string; recovery: string } {
  const maybe = error as {
    status?: number;
    message?: string;
    error?: { message?: string; code?: string };
  };
  const status = maybe?.status;
  const lowerMessage = (maybe?.message || "").toLowerCase();
  const lowerApiErrorMessage = (maybe?.error?.message || "").toLowerCase();
  const merged = `${lowerMessage} ${lowerApiErrorMessage}`;
  const isAuthFailure =
    status === 401 ||
    status === 403 ||
    merged.includes("unauthorized") ||
    merged.includes("forbidden") ||
    merged.includes("invalid api key") ||
    merged.includes("access denied");

  if (isAuthFailure) {
    return {
      error: "Azure OpenAI authentication failed. Check your API key and endpoint.",
      recovery:
        "Rotate or regenerate AZURE_OPENAI_API_KEY, verify AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_VERSION, then retry.",
    };
  }

  const isFileNotReadyFailure =
    merged.includes("file_input_not_ready") ||
    merged.includes("giving up on waiting for file") ||
    (merged.includes("file") && merged.includes("processing"));
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

  const isDeploymentFailure =
    status === 404 || merged.includes("deployment") || merged.includes("not found");
  if (isDeploymentFailure) {
    return {
      error: "Azure OpenAI deployment was not found or is not available.",
      recovery:
        "Verify AZURE_OPENAI_DEPLOYMENT exactly matches your Azure deployment name (for example: ben-gpt-5.4).",
    };
  }

  const isApiVersionFailure = merged.includes("api-version") || merged.includes("api version");
  if (isApiVersionFailure) {
    return {
      error: "Azure OpenAI API version is invalid for this endpoint or model.",
      recovery:
        "Set AZURE_OPENAI_API_VERSION to the version shown in Azure for this deployment (for example: 2025-04-01-preview), then restart the server.",
    };
  }

  const isToolingFailure = merged.includes("web_search") || merged.includes("tool") || merged.includes("unsupported");
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
