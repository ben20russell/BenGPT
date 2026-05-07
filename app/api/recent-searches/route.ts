import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type StoredTurn = {
  id?: string;
  user?: string;
  assistant?: string;
  citations?: Array<{ url?: string; title?: string }>;
  mode?: "quick" | "web_search" | "thinking" | "deep_research";
  error?: string;
};

type StoredConversation = {
  id?: string;
  title?: string;
  turns?: StoredTurn[];
};

type RecentSearchPayload = {
  conversations?: StoredConversation[];
  activeConversationId?: string | null;
};

type StoredRecentSearchesRecord = Record<
  string,
  {
    conversations: StoredConversation[];
    activeConversationId: string | null;
    updatedAt: string;
  }
>;

function getStorePath() {
  const explicit = process.env.RECENT_SEARCHES_STORE_PATH?.trim();
  if (explicit) return explicit;
  return path.join(process.cwd(), ".data", "recent-searches.json");
}

async function readStore(): Promise<StoredRecentSearchesRecord> {
  const filePath = getStorePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as StoredRecentSearchesRecord;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.log("[/api/recent-searches] Store shape invalid; resetting");
      return {};
    }
    return parsed;
  } catch (error) {
    const maybe = error as { code?: string };
    if (maybe?.code === "ENOENT") {
      console.log("[/api/recent-searches] Store file not found; starting empty");
      return {};
    }
    console.log("[/api/recent-searches] Failed to read store", { error });
    throw error;
  }
}

async function writeStore(next: StoredRecentSearchesRecord) {
  const filePath = getStorePath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  const ip = forwarded || realIp || cfIp || "unknown-ip";
  return ip;
}

function getDeviceId(req: NextRequest): string {
  const value = req.headers.get("x-device-id")?.trim();
  if (!value) return "unknown-device";
  return value.slice(0, 128);
}

function buildClientKey(req: NextRequest): string {
  const ip = getClientIp(req);
  const device = getDeviceId(req);
  return `${ip}::${device}`;
}

function sanitizeConversations(raw: unknown): StoredConversation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((conversation) => {
      const maybeConversation = conversation as StoredConversation;
      const turns = Array.isArray(maybeConversation.turns)
        ? maybeConversation.turns
            .filter((turn) => turn && typeof turn === "object")
            .map((turn) => {
              const maybeTurn = turn as StoredTurn;
              return {
                id: typeof maybeTurn.id === "string" ? maybeTurn.id : "",
                user: typeof maybeTurn.user === "string" ? maybeTurn.user : "",
                assistant: typeof maybeTurn.assistant === "string" ? maybeTurn.assistant : "",
                citations: Array.isArray(maybeTurn.citations) ? maybeTurn.citations : [],
                mode:
                  maybeTurn.mode === "quick" ||
                  maybeTurn.mode === "web_search" ||
                  maybeTurn.mode === "thinking" ||
                  maybeTurn.mode === "deep_research"
                    ? maybeTurn.mode
                    : "quick",
                error: typeof maybeTurn.error === "string" ? maybeTurn.error : undefined,
              } satisfies StoredTurn;
            })
        : [];

      return {
        id: typeof maybeConversation.id === "string" ? maybeConversation.id : "",
        title: typeof maybeConversation.title === "string" ? maybeConversation.title : "Untitled",
        turns,
      } satisfies StoredConversation;
    });
}

export async function GET(req: NextRequest) {
  try {
    const key = buildClientKey(req);
    console.log("[/api/recent-searches] GET request", { key });
    const store = await readStore();
    const existing = store[key];
    if (!existing) {
      console.log("[/api/recent-searches] No recents found for key", { key });
      return NextResponse.json({
        conversations: [],
        activeConversationId: null,
      });
    }

    console.log("[/api/recent-searches] Returning recents", {
      key,
      conversations: existing.conversations.length,
      activeConversationId: existing.activeConversationId,
      updatedAt: existing.updatedAt,
    });

    return NextResponse.json({
      conversations: existing.conversations,
      activeConversationId: existing.activeConversationId,
    });
  } catch (error) {
    console.log("[/api/recent-searches] GET failed", { error });
    return NextResponse.json(
      {
        error: "Could not load recent searches.",
        recovery: "Try again in a moment.",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const key = buildClientKey(req);
    const body = (await req.json()) as RecentSearchPayload;
    const conversations = sanitizeConversations(body.conversations);
    const activeConversationId =
      typeof body.activeConversationId === "string" ? body.activeConversationId : null;

    console.log("[/api/recent-searches] POST request", {
      key,
      conversations: conversations.length,
      activeConversationId,
    });

    const store = await readStore();
    store[key] = {
      conversations,
      activeConversationId,
      updatedAt: new Date().toISOString(),
    };
    await writeStore(store);

    console.log("[/api/recent-searches] Saved recents", {
      key,
      conversations: conversations.length,
      activeConversationId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("[/api/recent-searches] POST failed", { error });
    return NextResponse.json(
      {
        error: "Could not save recent searches.",
        recovery: "Try again in a moment.",
      },
      { status: 500 },
    );
  }
}
