import { NextRequest, NextResponse } from "next/server";
import { createAzureClient, getAzureConfig, type UploadsApi } from "../../_lib";

export const runtime = "nodejs";

type ChunkedCompletePayload = {
  uploadId?: string;
  partIds?: string[];
};

function sanitizePartIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

export async function POST(req: NextRequest) {
  try {
    const config = getAzureConfig();
    if (config.missing.length > 0) {
      console.log("[/api/files/upload/chunked/complete] Missing Azure OpenAI environment variables", {
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

    const body = (await req.json().catch(() => null)) as ChunkedCompletePayload | null;
    const uploadId = typeof body?.uploadId === "string" ? body.uploadId.trim() : "";
    const partIds = sanitizePartIds(body?.partIds);

    if (!uploadId) {
      console.log("[/api/files/upload/chunked/complete] Validation failed: uploadId missing");
      return NextResponse.json(
        {
          error: "Chunked upload completion requires uploadId.",
          recovery: "Restart upload and try again.",
        },
        { status: 400 },
      );
    }

    if (partIds.length === 0) {
      console.log("[/api/files/upload/chunked/complete] Validation failed: no part ids", {
        uploadId,
      });
      return NextResponse.json(
        {
          error: "Chunked upload completion requires at least one partId.",
          recovery: "Restart upload and try again.",
        },
        { status: 400 },
      );
    }

    console.log("[/api/files/upload/chunked/complete] Completing upload", {
      uploadId,
      partCount: partIds.length,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion,
    });

    const client = createAzureClient(config);
    const completion = await (client as unknown as UploadsApi).uploads.complete(uploadId, {
      part_ids: partIds,
    });
    const fileId = typeof completion?.file?.id === "string" ? completion.file.id : "";

    if (!fileId) {
      console.log("[/api/files/upload/chunked/complete] Upload completion returned no file id", {
        uploadId,
        partCount: partIds.length,
        completion,
      });
      return NextResponse.json(
        {
          error: "Upload completed but no file ID was returned.",
          recovery: "Retry upload completion. If this persists, verify Uploads API support for this deployment.",
        },
        { status: 502 },
      );
    }

    console.log("[/api/files/upload/chunked/complete] Upload completed successfully", {
      uploadId,
      partCount: partIds.length,
      fileId,
    });

    return NextResponse.json({
      fileId,
      uploadId,
      partCount: partIds.length,
    });
  } catch (error) {
    console.log("[/api/files/upload/chunked/complete] Upload completion failed", { error });
    return NextResponse.json(
      {
        error: "Could not finalize chunked upload.",
        recovery: "Try again. If it keeps failing, restart upload.",
      },
      { status: 500 },
    );
  }
}
