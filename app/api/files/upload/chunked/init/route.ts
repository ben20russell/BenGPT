import { NextRequest, NextResponse } from "next/server";
import {
  coerceMimeType,
  coerceSafeFilename,
  createAzureClient,
  getAzureConfig,
  type UploadsApi,
} from "../../_lib";

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

    const client = createAzureClient(config);
    const upload = await (client as unknown as UploadsApi).uploads.create({
      bytes: size,
      filename,
      mime_type: mimeType,
      purpose: "assistants",
    });
    const uploadId = typeof upload?.id === "string" ? upload.id : "";

    if (!uploadId) {
      console.log("[/api/files/upload/chunked/init] Uploads API returned no upload id", {
        upload,
        filename,
      });
      return NextResponse.json(
        {
          error: "Could not initialize chunked upload session.",
          recovery: "Retry upload. If this persists, verify Uploads API support for this Azure deployment.",
        },
        { status: 502 },
      );
    }

    console.log("[/api/files/upload/chunked/init] Uploads session created", {
      uploadId,
      filename,
      size,
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
