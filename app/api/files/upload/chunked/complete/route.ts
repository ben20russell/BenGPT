import { NextRequest, NextResponse } from "next/server";
import {
  createAzureClient,
  FILE_UPLOAD_PURPOSE_ORDER,
  getAzureConfig,
  isPurposeRejectedError,
  type FilesApi,
  type UploadPurpose,
  type UploadsApi,
} from "../../_lib";
import {
  LOCAL_UPLOAD_STRATEGY,
  assembleLocalChunkedUpload,
  clearLocalChunkedUpload,
  isLocalChunkedUploadId,
} from "../local-store";

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

    if (isLocalChunkedUploadId(uploadId)) {
      console.log("[/api/files/upload/chunked/complete] Completing local chunked upload strategy", {
        uploadId,
        partCount: partIds.length,
      });
      try {
        const assembled = await assembleLocalChunkedUpload({
          uploadId,
          partIds,
        });

        const client = createAzureClient(config);
        let uploaded: { id?: string } | null = null;
        let selectedPurpose: UploadPurpose | null = null;
        for (const purpose of FILE_UPLOAD_PURPOSE_ORDER) {
          try {
            uploaded = await (client as unknown as FilesApi).files.create({
              file: assembled.file,
              purpose,
            });
            selectedPurpose = purpose;
            break;
          } catch (error) {
            const shouldFallback = purpose === "user_data" && isPurposeRejectedError(error);
            if (!shouldFallback) {
              throw error;
            }
            console.log(
              "[/api/files/upload/chunked/complete] Local completion file create rejected user_data purpose; retrying with assistants",
              {
                uploadId,
                filename: assembled.meta.filename,
                mimeType: assembled.meta.mimeType,
                bytes: assembled.bytes,
                error,
              },
            );
          }
        }

        const fileId = typeof uploaded?.id === "string" ? uploaded.id : "";
        if (!fileId) {
          console.log("[/api/files/upload/chunked/complete] Local completion file create returned no file id", {
            uploadId,
            partCount: partIds.length,
          });
          return NextResponse.json(
            {
              error: "Chunked upload completed but no file ID was returned.",
              recovery: "Retry upload completion. If this persists, verify Azure Files API support for this deployment.",
            },
            { status: 502 },
          );
        }

        console.log("[/api/files/upload/chunked/complete] Local chunked upload completed successfully", {
          uploadId,
          partCount: partIds.length,
          fileId,
          bytes: assembled.bytes,
          purpose: selectedPurpose,
        });

        return NextResponse.json({
          fileId,
          uploadId,
          partCount: partIds.length,
          strategy: LOCAL_UPLOAD_STRATEGY,
        });
      } finally {
        await clearLocalChunkedUpload(uploadId).catch((cleanupError) => {
          console.log("[/api/files/upload/chunked/complete] Failed to clear local chunked upload artifacts", {
            uploadId,
            cleanupError,
          });
        });
      }
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
