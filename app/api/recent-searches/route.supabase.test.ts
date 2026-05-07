/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateClient = vi.fn();

vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: mockCreateClient,
  };
});

describe("POST/GET /api/recent-searches (Supabase path)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateClient.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    delete process.env.RECENT_SEARCHES_STORE_PATH;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("writes recents to Supabase via upsert", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    const mockSelect = vi.fn();
    const mockFrom = vi.fn(() => ({
      upsert: mockUpsert,
      select: mockSelect,
    }));
    mockCreateClient.mockReturnValue({
      from: mockFrom,
    });

    const { POST } = await import("./route");

    const saveReq = new Request("http://localhost/api/recent-searches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.10",
        "x-device-id": "device-a",
      },
      body: JSON.stringify({
        activeConversationId: "c1",
        conversations: [{ id: "c1", title: "First", turns: [] }],
      }),
    });

    const saveRes = await POST(saveReq as never);
    expect(saveRes.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith("recent_searches");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        client_key: "203.0.113.10::device-a",
        device_id: "device-a",
        ip_address: "203.0.113.10",
        active_conversation_id: "c1",
      }),
      { onConflict: "client_key" },
    );
  });

  it("reads recents from Supabase via maybeSingle", async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        conversations: [{ id: "c7", title: "Loaded", turns: [] }],
        active_conversation_id: "c7",
        updated_at: "2026-05-07T00:00:00.000Z",
      },
      error: null,
    });
    const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    const mockFrom = vi.fn(() => ({
      upsert: vi.fn(),
      select: mockSelect,
    }));
    mockCreateClient.mockReturnValue({
      from: mockFrom,
    });

    const { GET } = await import("./route");

    const loadReq = new Request("http://localhost/api/recent-searches", {
      method: "GET",
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "x-device-id": "device-a",
      },
    });

    const loadRes = await GET(loadReq as never);
    const loadJson = await loadRes.json();

    expect(loadRes.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith("recent_searches");
    expect(mockSelect).toHaveBeenCalledWith("conversations, active_conversation_id, updated_at");
    expect(mockEq).toHaveBeenCalledWith("client_key", "203.0.113.10::device-a");
    expect(loadJson.activeConversationId).toBe("c7");
    expect(loadJson.conversations).toHaveLength(1);
  });
});
