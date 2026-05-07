/** @vitest-environment node */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "./route";

describe("POST/GET /api/recent-searches", () => {
  let tempDir = "";
  let storePath = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recent-searches-"));
    storePath = path.join(tempDir, "store.json");
    process.env.RECENT_SEARCHES_STORE_PATH = storePath;
  });

  afterEach(async () => {
    delete process.env.RECENT_SEARCHES_STORE_PATH;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("stores and returns recents scoped to ip + device", async () => {
    const saveReq = new Request("http://localhost/api/recent-searches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.10",
        "x-device-id": "device-a",
      },
      body: JSON.stringify({
        activeConversationId: "c2",
        conversations: [
          { id: "c1", title: "First", turns: [] },
          { id: "c2", title: "Second", turns: [] },
        ],
      }),
    });

    const saveRes = await POST(saveReq as never);
    expect(saveRes.status).toBe(200);

    const loadReqSame = new Request("http://localhost/api/recent-searches", {
      method: "GET",
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "x-device-id": "device-a",
      },
    });
    const loadResSame = await GET(loadReqSame as never);
    const loadJsonSame = await loadResSame.json();

    expect(loadResSame.status).toBe(200);
    expect(loadJsonSame.activeConversationId).toBe("c2");
    expect(loadJsonSame.conversations).toHaveLength(2);

    const loadReqOtherDevice = new Request("http://localhost/api/recent-searches", {
      method: "GET",
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "x-device-id": "device-b",
      },
    });
    const loadResOther = await GET(loadReqOtherDevice as never);
    const loadJsonOther = await loadResOther.json();

    expect(loadResOther.status).toBe(200);
    expect(loadJsonOther.conversations).toHaveLength(0);
    expect(loadJsonOther.activeConversationId).toBeNull();
  });

  it("does not cap recents count", async () => {
    const conversations = Array.from({ length: 130 }, (_, index) => ({
      id: `c-${index}`,
      title: `Conversation ${index}`,
      turns: [],
    }));

    const saveReq = new Request("http://localhost/api/recent-searches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "198.51.100.9",
        "x-device-id": "device-unlimited",
      },
      body: JSON.stringify({
        activeConversationId: "c-129",
        conversations,
      }),
    });

    const saveRes = await POST(saveReq as never);
    expect(saveRes.status).toBe(200);

    const loadReq = new Request("http://localhost/api/recent-searches", {
      method: "GET",
      headers: {
        "x-forwarded-for": "198.51.100.9",
        "x-device-id": "device-unlimited",
      },
    });
    const loadRes = await GET(loadReq as never);
    const loadJson = await loadRes.json();

    expect(loadRes.status).toBe(200);
    expect(loadJson.conversations).toHaveLength(130);
    expect(loadJson.activeConversationId).toBe("c-129");
  });
});
