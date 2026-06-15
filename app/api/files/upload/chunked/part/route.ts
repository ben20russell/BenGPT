import { NextRequest, NextResponse } from "next/server";
import { createAzureClient, getAzureConfig, type UploadsApi } from "../../_lib";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const config = getAzureConfig();
    if (config.missing.length > 0) {
      console.log("[/api/files/upload/chunked/part] Missing Azure OpenAI environment variables", {
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

    const formData = await req.formData();
    const uploadId = String(formData.get("uploadId") || "").trim();
    const partIndexRaw = formData.get("partIndex");
    const partIndex = typeof partIndexRaw === "string" ? partIndexRaw.trim() : "";
    const partField = formData.get("part");

    if (!uploadId) {
      console.log("[/api/files/upload/chunked/part] Validation failed: uploadId missing");
      return NextResponse.json(
        {
          error: "Missing uploadId for chunked upload part.",
          recovery: "Restart upload and retry.",
        },
        { status: 400 },
      );
    }

    if (!(partField instanceof File)) {
      console.log("[/api/files/upload/chunked/part] Validation failed: no part field found", {
        uploadId,
      });
      return NextResponse.json(
        {
          error: "No chunk data was uploaded.",
          recovery: "Retry upload part.",
        },
        { status: 400 },
      );
    }

    if (partField.size <= 0) {
      console.log("[/api/files/upload/chunked/part] Validation failed: part is empty", {
        uploadId,
        partIndex,
      });
      return NextResponse.json(
        {
          error: "Uploaded chunk is empty.",
          recovery: "Retry upload part.",
        },
        { status: 400 },
      );
    }

    console.log("[/api/files/upload/chunked/part] Uploading part", {
      uploadId,
      partIndex,
      size: partField.size,
      type: partField.type,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion,
    });

    const client = createAzureClient(config);
    const part = await (client as unknown as UploadsApi).uploads.parts.create(uploadId, {
      data: partField,
    });
    const partId = typeof part?.id === "string" ? part.id : "";

    if (!partId) {
      console.log("[/api/files/upload/chunked/part] Uploads parts API returned no part id", {
        uploadId,
        partIndex,
        part,
      });
      return NextResponse.json(
        {
          error: "Could not upload chunk part.",
          recovery: "Retry upload from the last chunk.",
        },
        { status: 502 },
      );
    }

    console.log("[/api/files/upload/chunked/part] Uploaded part successfully", {
      uploadId,
      partIndex,
      partId,
      size: partField.size,
    });

    return NextResponse.json({
      partId,
      uploadId,
    });
  } catch (error) {
    console.log("[/api/files/upload/chunked/part] Upload part failed", { error });
    return NextResponse.json(
      {
        error: "Could not upload file chunk.",
        recovery: "Try again. If it keeps failing, restart the upload.",
      },
      { status: 500 },
    );
  }
}
