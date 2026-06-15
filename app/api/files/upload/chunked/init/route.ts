import { NextRequest, NextResponse } from "next/server";
import {
  coerceMimeType,
  coerceSafeFilename,
  createAzureClient,
  FILE_UPLOAD_PURPOSE_ORDER,
  getAzureConfig,
  isPurposeRejectedError,
  type UploadPurpose,
  type UploadsApi,
} from "../../_lib";
import { createLocalChunkedUploadSession } from "../local-store";

export const runtime = "nodejs";

type ChunkedInitPayload = {
  name?: string;
  size?: number;
  type?: string;
};

function parseSize(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.trunc(raw);
}

export async function POST(req: NextRequest) {
  try {
    const config = getAzureConfig();
    if (config.missing.length > 0) {
      console.log("[/api/files/upload/chunked/init] Missing Azure OpenAI environment variables", {
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

    const body = (await req.json().catch(() => null)) as ChunkedInitPayload | null;
    const size = parseSize(body?.size);
    const filename = coerceSafeFilename(typeof body?.name === "string" ? body.name : undefined);
    const mimeType = coerceMimeType(typeof body?.type === "string" ? body.type : undefined);

    if (size <= 0) {
      console.log("[/api/files/upload/chunked/init] Validation failed: invalid size", {
        receivedSize: body?.size,
        filename,
      });
      return NextResponse.json(
        {
          error: "Chunked upload requires a positive file size.",
          recovery: "Retry upload with a valid file.",
        },
        { status: 400 },
      );
    }

    console.log("[/api/files/upload/chunked/init] Creating uploads session", {
      filename,
      size,
      mimeType,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion,
    });

    async function createLocalFallbackSession(reason: unknown) {
      console.log("[/api/files/upload/chunked/init] Falling back to local chunked upload session", {
        filename,
        size,
        mimeType,
        reason,
      });
      const localSession = await createLocalChunkedUploadSession({
        filename,
        mimeType,
        size,
      });
      return NextResponse.json({
        uploadId: localSession.uploadId,
        name: filename,
        size,
        type: mimeType,
        strategy: localSession.strategy,
      });
    }

    const client = createAzureClient(config);
    let upload: { id?: string } | null = null;
    let selectedPurpose: UploadPurpose | null = null;
    for (const purpose of FILE_UPLOAD_PURPOSE_ORDER) {
      try {
        upload = await (client as unknown as UploadsApi).uploads.create({
          bytes: size,
          filename,
          mime_type: mimeType,
          purpose,
        });
        selectedPurpose = purpose;
        break;
      } catch (error) {
        const shouldFallback = purpose === "user_data" && isPurposeRejectedError(error);
        if (shouldFallback) {
          console.log("[/api/files/upload/chunked/init] user_data purpose rejected by deployment; retrying with assistants", {
            filename,
            size,
            mimeType,
            error,
          });
          continue;
        }

        console.log("[/api/files/upload/chunked/init] Uploads API init failed; switching to local strategy", {
          filename,
          size,
          mimeType,
          purpose,
          error,
        });
        return await createLocalFallbackSession(error);
      }
    }
    const uploadId = typeof upload?.id === "string" ? upload.id : "";

    if (!uploadId) {
      console.log("[/api/files/upload/chunked/init] Uploads API returned no upload id; switching to local strategy", {
        upload,
        filename,
      });
      return await createLocalFallbackSession({
        reason: "missing_upload_id",
        upload,
      });
    }

    console.log("[/api/files/upload/chunked/init] Uploads session created", {
      uploadId,
      filename,
      size,
      purpose: selectedPurpose,
    });

    return NextResponse.json({
      uploadId,
      name: filename,
      size,
      type: mimeType,
    });
  } catch (error) {
    console.log("[/api/files/upload/chunked/init] Failed to create uploads session", { error });
    return NextResponse.json(
      {
        error: "Could not start chunked upload.",
        recovery: "Try again. If it keeps failing, verify Azure OpenAI Uploads API support and env settings.",
      },
      { status: 500 },
    );
  }
}
