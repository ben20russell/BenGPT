import { NextRequest, NextResponse } from "next/server";
import {
  createAzureClient,
  FILE_UPLOAD_PURPOSE_ORDER,
  getAzureConfig,
  isPurposeRejectedError,
  type FilesApi,
  type UploadPurpose,
} from "./_lib";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const config = getAzureConfig();
    if (config.missing.length > 0) {
      console.log("[/api/files/upload] Missing Azure OpenAI environment variables", {
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
    const fileField = formData.get("file");
    if (!(fileField instanceof File)) {
      console.log("[/api/files/upload] Validation failed: no file field found");
      return NextResponse.json(
        {
          error: "No file was uploaded.",
          recovery: "Attach a file and try again.",
        },
        { status: 400 },
      );
    }

    if (fileField.size <= 0) {
      console.log("[/api/files/upload] Validation failed: uploaded file is empty", {
        name: fileField.name,
      });
      return NextResponse.json(
        {
          error: "The uploaded file is empty.",
          recovery: "Choose a non-empty file and try again.",
        },
        { status: 400 },
      );
    }

    console.log("[/api/files/upload] Uploading file to Azure OpenAI Files API", {
      name: fileField.name,
      size: fileField.size,
      type: fileField.type,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion,
    });

    const client = createAzureClient(config);
    let uploaded: { id?: string } | null = null;
    let selectedPurpose: UploadPurpose | null = null;
    for (const purpose of FILE_UPLOAD_PURPOSE_ORDER) {
      try {
        uploaded = await (client as unknown as FilesApi).files.create({
          file: fileField,
          purpose,
        });
        selectedPurpose = purpose;
        break;
      } catch (error) {
        const shouldFallback = purpose === "user_data" && isPurposeRejectedError(error);
        if (!shouldFallback) {
          throw error;
        }
        console.log("[/api/files/upload] user_data purpose rejected by deployment; retrying with assistants", {
          name: fileField.name,
          size: fileField.size,
          type: fileField.type,
          error,
        });
      }
    }

    const fileId = typeof uploaded?.id === "string" ? uploaded.id : "";
    if (!fileId) {
      console.log("[/api/files/upload] Files API returned no file id", { uploaded });
      return NextResponse.json(
        {
          error: "Upload completed but no file ID was returned.",
          recovery: "Retry the upload. If this persists, check Azure OpenAI file support for this deployment.",
        },
        { status: 502 },
      );
    }

    console.log("[/api/files/upload] File uploaded successfully", {
      name: fileField.name,
      size: fileField.size,
      type: fileField.type,
      fileId,
      purpose: selectedPurpose,
    });

    return NextResponse.json({
      fileId,
      name: fileField.name,
      size: fileField.size,
      type: fileField.type,
    });
  } catch (error) {
    console.log("[/api/files/upload] Upload failed", { error });
    return NextResponse.json(
      {
        error: "Could not upload the file for model parsing.",
        recovery: "Try again. If it keeps failing, verify Azure OpenAI file support and environment settings.",
      },
      { status: 500 },
    );
  }
}
