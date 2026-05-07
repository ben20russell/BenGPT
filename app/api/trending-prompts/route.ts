import { NextResponse } from "next/server";

type CachedPromptResult = {
  suggestions: string[];
  generatedAt: string;
  expiresAt: string;
};

const FEED_URLS = [
  "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
  "https://feeds.bbci.co.uk/news/rss.xml",
];

const ONE_HOUR_MS = 60 * 60 * 1000;
let cachedResult: CachedPromptResult | null = null;

function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function cleanupTitle(raw: string): string {
  let cleaned = decodeEntities(raw)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  cleaned = cleaned.replace(/\s+-\s+(Reuters|AP News|BBC News|NPR|CNBC|CNN|The New York Times).*$/i, "");
  return cleaned;
}

function parseRssTitles(xml: string): string[] {
  const titles: string[] = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const item of itemMatches) {
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
    if (!titleMatch?.[1]) continue;
    const title = cleanupTitle(titleMatch[1]);
    if (!title || title.length < 18) continue;
    titles.push(title);
  }
  return titles;
}

function hourSeed(now: Date): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  const h = now.getUTCHours();
  return y * 1000000 + m * 10000 + d * 100 + h;
}

function seededRandom(seedStart: number) {
  let seed = seedStart >>> 0;
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function buildPromptsFromHeadlines(headlines: string[], now: Date): string[] {
  const templates = [
    (headline: string) => `What are the key implications of: "${headline}"?`,
    (headline: string) => `Give me a concise briefing on "${headline}" with likely second-order effects.`,
    (headline: string) => `How could "${headline}" impact businesses and consumers over the next month?`,
    (headline: string) => `Summarize "${headline}" and compare how major sources are framing it.`,
    (headline: string) => `Turn "${headline}" into a research checklist with sources to verify.`,
    (headline: string) => `What should I watch next after "${headline}" develops?`,
  ];

  const random = seededRandom(hourSeed(now));
  const deduped = Array.from(new Set(headlines)).slice(0, 50);
  const prompts: string[] = [];

  while (prompts.length < 6 && deduped.length > 0) {
    const headlineIndex = Math.floor(random() * deduped.length);
    const templateIndex = Math.floor(random() * templates.length);
    const headline = deduped.splice(headlineIndex, 1)[0];
    if (!headline) continue;
    prompts.push(templates[templateIndex](headline));
  }

  return prompts;
}

async function fetchRssFeed(url: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "BeaconSearchBot/1.0" },
    });
    if (!response.ok) return [];
    const xml = await response.text();
    return parseRssTitles(xml);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const now = new Date();
  if (cachedResult && new Date(cachedResult.expiresAt).getTime() > now.getTime()) {
    return NextResponse.json(cachedResult);
  }

  try {
    const titleLists = await Promise.all(FEED_URLS.map((url) => fetchRssFeed(url)));
    const titles = titleLists.flat();
    const suggestions = buildPromptsFromHeadlines(titles, now);

    const result: CachedPromptResult = {
      suggestions:
        suggestions.length > 0
          ? suggestions
          : [
              "What are today’s most important global headlines and why do they matter?",
              "Which current technology stories are worth tracking this week?",
              "Summarize the top business and policy news shaping markets right now.",
              "What major stories are emerging in AI, climate, and geopolitics today?",
            ],
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ONE_HOUR_MS).toISOString(),
    };

    cachedResult = result;
    return NextResponse.json(result);
  } catch (error) {
    console.log("[/api/trending-prompts] Failed to build suggestions", { error });
    return NextResponse.json(
      {
        suggestions: [
          "What are today’s most important global headlines and why do they matter?",
          "Which current technology stories are worth tracking this week?",
          "Summarize the top business and policy news shaping markets right now.",
          "What major stories are emerging in AI, climate, and geopolitics today?",
        ],
        generatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ONE_HOUR_MS).toISOString(),
      },
      { status: 200 },
    );
  }
}
