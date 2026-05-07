import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const selectedKey = serviceRoleKey || publishableKey;
  const keyMode = serviceRoleKey ? "service_role" : publishableKey ? "publishable" : "missing";
  const allowLocalFallback =
    process.env.NODE_ENV === "test" || process.env.RECENT_SEARCHES_ALLOW_FILE_FALLBACK === "true";

  if (!supabaseUrl || !selectedKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        diagnostics: {
          hasSupabaseUrl: Boolean(supabaseUrl),
          hasPublishableKey: Boolean(publishableKey),
          hasServiceRoleKey: Boolean(serviceRoleKey),
          keyMode,
          allowLocalFallback,
        },
      },
      { status: 500 },
    );
  }

  try {
    const supabase = createClient(supabaseUrl, selectedKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabase
      .from("recent_searches")
      .select("client_key, updated_at")
      .limit(1);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "Supabase query failed.",
          diagnostics: {
            keyMode,
            allowLocalFallback,
            message: typeof error.message === "string" ? error.message : String(error),
          },
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      diagnostics: {
        keyMode,
        allowLocalFallback,
      },
      supabase: {
        connected: true,
        sampleRows: Array.isArray(data) ? data.length : 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Supabase connection setup failed.",
        diagnostics: {
          keyMode,
          allowLocalFallback,
          message: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 },
    );
  }
}
