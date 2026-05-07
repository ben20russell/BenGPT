/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateClient = vi.fn();

vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: mockCreateClient,
  };
});

describe("GET /api/recent-searches/health", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateClient.mockReset();
    delete process.env.RECENT_SEARCHES_ALLOW_FILE_FALLBACK;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("returns 500 when required Supabase env vars are missing", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toContain("Missing Supabase environment variables");
  });

  it("returns 200 when Supabase is reachable", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

    const mockLimit = vi.fn().mockResolvedValue({ data: [{ client_key: "a::b" }], error: null });
    const mockSelect = vi.fn(() => ({ limit: mockLimit }));
    const mockFrom = vi.fn(() => ({ select: mockSelect }));
    mockCreateClient.mockReturnValue({ from: mockFrom });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.supabase.connected).toBe(true);
    expect(json.supabase.sampleRows).toBe(1);
    expect(mockFrom).toHaveBeenCalledWith("recent_searches");
  });
});
