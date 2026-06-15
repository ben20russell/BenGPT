import { AzureOpenAI } from "openai";

export type UploadPurpose = "assistants" | "user_data";
export const FILE_UPLOAD_PURPOSE_ORDER: UploadPurpose[] = ["user_data", "assistants"];
const PURPOSE_INVALIDITY_PATTERNS = ["invalid", "unsupported", "not supported", "allowed"] as const;
const PURPOSE_INVALID_CODE_PATTERNS = ["invalid", "unsupported", "not_allowed", "bad_request"] as const;

export type FilesApi = {
  files: {
    create: (params: { file: File; purpose: UploadPurpose }) => Promise<{ id?: string }>;
  };
};

export type UploadsApi = {
  uploads: {
    create: (params: {
      bytes: number;
      filename: string;
      mime_type: string;
      purpose: UploadPurpose;
    }) => Promise<{ id?: string }>;
    complete: (uploadId: string, params: { part_ids: string[] }) => Promise<{ file?: { id?: string } | null }>;
    parts: {
      create: (uploadId: string, params: { data: File }) => Promise<{ id?: string }>;
    };
  };
};

function normalizeAzureEndpoint(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/openai$/i, "");
}

export function getAzureConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  const endpoint = normalizeAzureEndpoint(
    process.env.AZURE_OPENAI_ENDPOINT ?? process.env.OPENAI_ENDPOINT,
  );
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? process.env.OPENAI_API_VERSION;

  const missing: string[] = [];
  if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
  if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
  if (!apiVersion) missing.push("AZURE_OPENAI_API_VERSION");

  return { apiKey, endpoint, apiVersion, missing };
}

export function createAzureClient(config: {
  apiKey: string | undefined;
  endpoint: string | undefined;
  apiVersion: string | undefined;
}) {
  return new AzureOpenAI({
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    apiVersion: config.apiVersion,
  });
}

export function coerceSafeFilename(name: string | undefined, fallback = "upload.bin"): string {
  const normalized = String(name || "").trim().replaceAll(/[\r\n\t]/g, " ").slice(0, 220);
  return normalized || fallback;
}

export function coerceMimeType(type: string | undefined): string {
  const normalized = String(type || "").trim().slice(0, 120);
  return normalized || "application/octet-stream";
}

function hasAnyPattern(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export function isPurposeRejectedError(error: unknown): boolean {
  const maybe = error as {
    status?: number;
    message?: string;
    code?: string;
    param?: string;
    error?: { message?: string; code?: string };
  };
  const status = typeof maybe?.status === "number" ? maybe.status : undefined;
  const merged = `${String(maybe?.message || "")} ${String(maybe?.error?.message || "")}`.toLowerCase();
  const rawParam = maybe?.param;
  const rawCode = maybe?.code ?? maybe?.error?.code;
  const normalizedParam = typeof rawParam === "string" ? rawParam.trim().toLowerCase() : "";
  const normalizedCode = typeof rawCode === "string" ? rawCode.trim().toLowerCase() : "";

  if (status !== 400 && status !== 422) return false;

  if (normalizedParam === "purpose") {
    return true;
  }

  const mentionsPurpose = merged.includes("purpose");
  if (!mentionsPurpose) {
    return false;
  }

  const mentionsInvalidity = hasAnyPattern(merged, PURPOSE_INVALIDITY_PATTERNS);
  const codeSuggestsInvalidValue = hasAnyPattern(normalizedCode, PURPOSE_INVALID_CODE_PATTERNS);
  return mentionsInvalidity || codeSuggestsInvalidValue;
}
