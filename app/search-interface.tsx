'use client';

import React, {
  Component,
  type ErrorInfo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Image from 'next/image';
import Link from 'next/link';

type SearchMode = 'quick' | 'web_search' | 'thinking' | 'deep_research';

const SEARCH_MODE_OPTIONS: Array<{ value: SearchMode; label: string }> = [
  { value: 'quick', label: 'Quick' },
  { value: 'web_search', label: 'Web Search' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'deep_research', label: 'Deep Research' },
];

type Citation = {
  url?: string;
  title?: string;
};

type UploadedContextFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  contentKind: 'text' | 'binary';
  contentText?: string;
  contentBase64?: string;
  note?: string;
};

type GitCodeContext = {
  id: string;
  label: string;
  code: string;
};

type HistoryTurnPayload = {
  user: string;
  assistant: string;
  mode: SearchMode;
};

type Turn = {
  id: string;
  user: string;
  assistant: string;
  citations: Citation[];
  mode: SearchMode;
  error?: string;
};

type Conversation = {
  id: string;
  title: string;
  turns: Turn[];
};

type RecentSearchesResponse = {
  conversations?: Conversation[];
  activeConversationId?: string | null;
};

type RecentSearchesLocalSnapshot = {
  conversations: Conversation[];
  activeConversationId: string | null;
};

type DeletedConversationSnapshot = {
  conversation: Conversation;
  index: number;
  wasActive: boolean;
};

const RECENTS_LAST_SNAPSHOT_KEY = 'beacon-search-recents:last';

type BoundaryState = {
  hasError: boolean;
  message: string;
};

const FALLBACK_WELCOME_SUGGESTIONS = [
  'What are the biggest pop culture moments trending this week?',
  'Break down the most talked-about celebrity stories right now.',
  'What should I watch next based on today’s streaming buzz?',
  'Which new music releases are dominating charts and social media?',
];

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; language: string; code: string }
  | { type: 'blockquote'; text: string }
  | { type: 'hr' }
  | { type: 'table'; headers: string[]; rows: string[][] };

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseInlineMarkdown(text: string, keyPrefix = 'md'): ReactNode[] {
  const tokenPattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = tokenPattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${match.index}`}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
        >
          {parseInlineMarkdown(match[2], `${keyPrefix}-link-inner-${match.index}`)}
        </a>,
      );
    } else if (match[4] || match[5]) {
      const strongText = match[4] ?? match[5] ?? '';
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`}>
          {parseInlineMarkdown(strongText, `${keyPrefix}-strong-inner-${match.index}`)}
        </strong>,
      );
    } else if (match[6]) {
      nodes.push(<del key={`${keyPrefix}-del-${match.index}`}>{match[6]}</del>);
    } else if (match[7]) {
      nodes.push(<code key={`${keyPrefix}-code-${match.index}`}>{match[7]}</code>);
    } else if (match[8] || match[9]) {
      const emText = match[8] ?? match[9] ?? '';
      nodes.push(
        <em key={`${keyPrefix}-em-${match.index}`}>
          {parseInlineMarkdown(emText, `${keyPrefix}-em-inner-${match.index}`)}
        </em>,
      );
    }

    lastIndex = tokenPattern.lastIndex;
    match = tokenPattern.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const fencedCodeMatch = trimmed.match(/^```([\w-]+)?\s*$/);
    if (fencedCodeMatch) {
      const language = fencedCodeMatch[1] ?? '';
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !(lines[i] ?? '').trim().match(/^```/)) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length && (lines[i] ?? '').trim().match(/^```/)) {
        i += 1;
      }
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2].trim(),
      });
      i += 1;
      continue;
    }

    if (trimmed.match(/^([-*_])(?:\s*\1){2,}\s*$/)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n').trim() });
      continue;
    }

    const nextLine = (lines[i + 1] ?? '').trim();
    const isTable =
      trimmed.includes('|') &&
      nextLine.length > 0 &&
      nextLine.match(/^\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/);

    if (isTable) {
      const headers = splitTableCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = (lines[i] ?? '').trim();
        if (!rowLine || !rowLine.includes('|')) break;
        rows.push(splitTableCells(rowLine));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const itemMatch = (lines[i] ?? '').trim().match(/^[-*+]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1]);
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const itemMatch = (lines[i] ?? '').trim().match(/^\d+\.\s+(.+)$/);
        if (!itemMatch) break;
        const itemLines = [itemMatch[1]];
        i += 1;

        while (i < lines.length) {
          const candidateRaw = lines[i] ?? '';
          const candidate = candidateRaw.trim();

          if (!candidate) {
            let lookahead = i + 1;
            while (lookahead < lines.length && !((lines[lookahead] ?? '').trim())) {
              lookahead += 1;
            }
            const nextCandidate = (lines[lookahead] ?? '').trim();
            if (nextCandidate.match(/^\d+\.\s+/)) {
              i = lookahead;
              break;
            }
            i += 1;
            continue;
          }

          if (
            candidate.match(/^\d+\.\s+/) ||
            candidate.match(/^[-*+]\s+/) ||
            candidate.match(/^```/) ||
            candidate.match(/^(#{1,6})\s+/) ||
            candidate.startsWith('>') ||
            candidate.match(/^([-*_])(?:\s*\1){2,}\s*$/)
          ) {
            break;
          }

          itemLines.push(candidate);
          i += 1;
        }

        items.push(itemLines.join(' '));
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const candidate = (lines[i] ?? '').trim();
      if (!candidate) break;
      if (
        candidate.match(/^```/) ||
        candidate.match(/^(#{1,6})\s+/) ||
        candidate.match(/^[-*+]\s+/) ||
        candidate.match(/^\d+\.\s+/) ||
        candidate.startsWith('>') ||
        candidate.match(/^([-*_])(?:\s*\1){2,}\s*$/)
      ) {
        break;
      }
      paragraphLines.push(candidate);
      i += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
      continue;
    }

    i += 1;
  }

  return blocks;
}

function isLikelyTextFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('yaml') ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('markdown')
  ) {
    return true;
  }

  const name = file.name.toLowerCase();
  return /\.(txt|md|markdown|csv|json|xml|yaml|yml|js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|sh|sql|ini|toml|log)$/.test(
    name,
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file as text'));
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read file as ArrayBuffer'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file as ArrayBuffer'));
    reader.readAsArrayBuffer(file);
  });
}

async function normalizeUploadFile(file: File): Promise<UploadedContextFile> {
  const base: UploadedContextFile = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || 'untitled',
    type: file.type || 'application/octet-stream',
    size: file.size,
    contentKind: 'binary',
  };

  try {
    if (isLikelyTextFile(file)) {
      const text = await readFileAsText(file);
      const maxChars = 60000;
      const trimmed = text.length > maxChars ? text.slice(0, maxChars) : text;
      return {
        ...base,
        contentKind: 'text',
        contentText: trimmed,
        note: text.length > maxChars ? 'Text truncated to 60,000 characters.' : undefined,
      };
    }

    const data = await readFileAsArrayBuffer(file);
    const base64 = arrayBufferToBase64(data);
    return {
      ...base,
      contentKind: 'binary',
      contentBase64: base64,
      note: 'Binary file included as base64 for model context.',
    };
  } catch (error) {
    console.log('[UI] Failed to parse uploaded file', { name: file.name, error });
    const fallbackText = await readFileAsText(file).catch(() => '');
    if (fallbackText) {
      const maxChars = 60000;
      const trimmed = fallbackText.length > maxChars ? fallbackText.slice(0, maxChars) : fallbackText;
      return {
        ...base,
        contentKind: 'text',
        contentText: trimmed,
        note: fallbackText.length > maxChars ? 'Text truncated to 60,000 characters.' : 'Read as plain text fallback.',
      };
    }

    throw new Error(`Could not read uploaded file content: ${file.name}`);
  }
}

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildPrintableConversationHtml(
  title: string,
  turns: Turn[],
  exportedAt: string,
  getModeLabel: (mode: SearchMode) => string,
) {
  const content = turns
    .map((turn, index) => {
      const safeUser = escapeHtml(turn.user);
      const safeAssistant = escapeHtml(turn.assistant || turn.error || '');
      const safeMode = escapeHtml(getModeLabel(turn.mode));
      const citationsHtml =
        turn.citations.length > 0
          ? `<div class="citations"><strong>Sources</strong><ul>${turn.citations
              .slice(0, 10)
              .map((citation) => {
                const link = citation.url || '';
                const titleText = citation.title || citation.url || 'Citation';
                return `<li>${link ? `<a href="${escapeHtml(link)}">${escapeHtml(titleText)}</a>` : escapeHtml(titleText)}</li>`;
              })
              .join('')}</ul></div>`
          : '';

      return `
        <section class="turn">
          <div class="turn-head">Turn ${index + 1} · ${safeMode}</div>
          <div class="bubble user">
            <div class="label">You</div>
            <pre>${safeUser}</pre>
          </div>
          <div class="bubble assistant">
            <div class="label">Assistant</div>
            <pre>${safeAssistant}</pre>
          </div>
          ${citationsHtml}
        </section>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)} - Export</title>
      <style>
        @page { size: auto; margin: 18mm; }
        :root { color-scheme: light; }
        body {
          margin: 0;
          font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
          color: #111827;
          background: #ffffff;
          line-height: 1.5;
        }
        .doc { max-width: 840px; margin: 0 auto; }
        .header { border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 20px; }
        .header h1 { font-size: 22px; margin: 0 0 6px; }
        .meta { font-size: 12px; color: #4b5563; }
        .turn { margin-bottom: 18px; page-break-inside: avoid; }
        .turn-head { font-size: 12px; color: #4b5563; margin-bottom: 8px; }
        .bubble {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 12px;
          margin-bottom: 10px;
        }
        .bubble.user { background: #f9fafb; }
        .bubble.assistant { background: #ffffff; }
        .label { font-weight: 600; font-size: 13px; margin-bottom: 8px; color: #111827; }
        pre {
          margin: 0;
          font-size: 14px;
          white-space: pre-wrap;
          word-wrap: break-word;
          font-family: inherit;
        }
        .citations {
          border-left: 3px solid #10a37f;
          background: #f7fdfb;
          padding: 8px 10px;
          font-size: 12px;
          color: #374151;
        }
        .citations ul { margin: 6px 0 0 18px; padding: 0; }
        .citations a { color: #0f766e; text-decoration: none; }
      </style>
    </head>
    <body>
      <main class="doc">
        <header class="header">
          <h1>${escapeHtml(title)}</h1>
          <div class="meta">Exported ${escapeHtml(exportedAt)} · ${turns.length} turn(s)</div>
        </header>
        ${content}
      </main>
    </body>
    </html>
  `;
}

class UIErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return {
      hasError: true,
      message: error.message || 'Something went wrong while rendering this page.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.log('[UIErrorBoundary] Caught rendering error', { error, info });
  }

  reset = () => {
    console.log('[UIErrorBoundary] Reset requested by user');
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="boundary-fallback" data-testid="ui-error-fallback">
        <h2>We hit a UI error.</h2>
        <p>{this.state.message}</p>
        <div className="boundary-actions">
          <button type="button" onClick={this.reset} data-testid="ui-retry-btn">
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()} data-testid="ui-reload-btn">
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

export default function SearchInterface() {
  const [toast, setToast] = useState('');
  const [isUiBooted, setIsUiBooted] = useState(process.env.NODE_ENV === 'test');
  const [deviceId, setDeviceId] = useState('');
  const [recentsHydrated, setRecentsHydrated] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingConversationTitle, setEditingConversationTitle] = useState('');
  const [recentlyDeletedConversation, setRecentlyDeletedConversation] = useState<DeletedConversationSnapshot | null>(
    null,
  );

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedContextFile[]>([]);
  const [gitSnippets, setGitSnippets] = useState<GitCodeContext[]>([]);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('quick');
  const [welcomeSuggestions, setWelcomeSuggestions] = useState<string[]>(FALLBACK_WELCOME_SUGGESTIONS);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messageWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );
  const hasResults = Boolean(activeConversation && activeConversation.turns.length > 0);

  function getRecentsStorageKey(currentDeviceId: string) {
    return `beacon-search-recents:${currentDeviceId}`;
  }

  function parseLocalRecentsSnapshot(raw: string | null): RecentSearchesLocalSnapshot | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<RecentSearchesLocalSnapshot>;
      const conversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
      const activeConversationId =
        typeof parsed.activeConversationId === 'string' ? parsed.activeConversationId : null;
      return { conversations, activeConversationId };
    } catch (error) {
      console.log('[UI] Failed to parse local recents snapshot', { error });
      return null;
    }
  }

  useEffect(() => {
    console.log('[UI] Component mounted');
    if (process.env.NODE_ENV === 'test') return;
    const bootTimer = window.setTimeout(() => {
      setIsUiBooted(true);
      console.log('[UI] Initial paint lock released');
    }, 0);
    return () => window.clearTimeout(bootTimer);
  }, []);

  useEffect(() => {
    try {
      const storageKey = 'beacon-search-device-id';
      const existing = window.localStorage.getItem(storageKey);
      if (existing) {
        console.log('[UI] Using existing device id', { deviceId: existing });
        setDeviceId(existing);
        return;
      }

      const generated = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(storageKey, generated);
      console.log('[UI] Generated new device id', { deviceId: generated });
      setDeviceId(generated);
    } catch (error) {
      const fallback = `dev-fallback-${Math.random().toString(36).slice(2, 10)}`;
      console.log('[UI] Failed to access localStorage for device id; using fallback', { error, fallback });
      setDeviceId(fallback);
    }
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;

    async function loadRecents() {
      try {
        const localStorageKey = getRecentsStorageKey(deviceId);
        const localSnapshot =
          parseLocalRecentsSnapshot(window.localStorage.getItem(localStorageKey)) ??
          parseLocalRecentsSnapshot(window.localStorage.getItem(RECENTS_LAST_SNAPSHOT_KEY));
        if (localSnapshot) {
          const localConversations = localSnapshot.conversations;
          const localActive = localSnapshot.activeConversationId;
          const localHasActive = localActive
            ? localConversations.some((conversation) => conversation.id === localActive)
            : false;
          setConversations(localConversations);
          setActiveConversationId(localHasActive ? localActive : null);
          console.log('[UI] Loaded recent searches from local backup', {
            key: localStorageKey,
            count: localConversations.length,
            activeConversationId: localHasActive ? localActive : null,
          });
        }

        console.log('[UI] Loading recent searches', { deviceId });
        const endpoint = process.env.NODE_ENV === 'test' ? 'http://localhost/api/recent-searches' : '/api/recent-searches';
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'x-device-id': deviceId,
          },
          cache: 'no-store',
        });
        if (!response.ok) {
          console.log('[UI] Recent searches load returned non-OK status', { status: response.status });
          return;
        }

        const json = (await response.json()) as RecentSearchesResponse;
        if (cancelled) return;

        const nextConversations = Array.isArray(json.conversations) ? json.conversations : [];
        const nextActiveId = typeof json.activeConversationId === 'string' ? json.activeConversationId : null;
        const hasActive = nextActiveId ? nextConversations.some((conversation) => conversation.id === nextActiveId) : false;
        if (nextConversations.length > 0 || hasActive) {
          setConversations(nextConversations);
          setActiveConversationId(hasActive ? nextActiveId : null);
          console.log('[UI] Recent searches loaded from server', {
            count: nextConversations.length,
            activeConversationId: hasActive ? nextActiveId : null,
          });
        } else {
          console.log('[UI] Server recent searches empty; retaining local backup if present');
        }
      } catch (error) {
        console.log('[UI] Failed to load recent searches', { error });
      } finally {
        if (!cancelled) {
          setRecentsHydrated(true);
        }
      }
    }

    void loadRecents();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    if (!recentsHydrated) return;
    if (isLoading) return;

    try {
      const localStorageKey = getRecentsStorageKey(deviceId);
      const payload: RecentSearchesLocalSnapshot = {
        conversations,
        activeConversationId,
      };
      window.localStorage.setItem(localStorageKey, JSON.stringify(payload));
      window.localStorage.setItem(RECENTS_LAST_SNAPSHOT_KEY, JSON.stringify(payload));
      console.log('[UI] Saved recent searches to local backup', {
        key: localStorageKey,
        fallbackKey: RECENTS_LAST_SNAPSHOT_KEY,
        count: conversations.length,
        activeConversationId,
      });
    } catch (error) {
      console.log('[UI] Failed to save recent searches to local backup', { error });
    }

    let cancelled = false;

    async function saveRecents() {
      try {
        console.log('[UI] Saving recent searches', {
          deviceId,
          count: conversations.length,
          activeConversationId,
        });
        const endpoint = process.env.NODE_ENV === 'test' ? 'http://localhost/api/recent-searches' : '/api/recent-searches';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-id': deviceId,
          },
          body: JSON.stringify({
            conversations,
            activeConversationId,
          }),
        });
        if (!response.ok && !cancelled) {
          console.log('[UI] Failed to save recent searches', { status: response.status });
        }
      } catch (error) {
        if (!cancelled) {
          console.log('[UI] Failed to save recent searches', { error });
        }
      }
    }

    void saveRecents();
    return () => {
      cancelled = true;
    };
  }, [deviceId, recentsHydrated, conversations, activeConversationId, isLoading]);

  useEffect(() => {
    if (!toast) return;
    console.log('[UI] Showing toast', toast);
    const t = window.setTimeout(() => {
      setToast('');
    }, 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!messageWrapRef.current) return;
    messageWrapRef.current.scrollTop = messageWrapRef.current.scrollHeight;
  }, [conversations, isLoading, searching]);

  useEffect(() => {
    if (!toolsMenuOpen) return;

    function onDocClick(event: globalThis.MouseEvent) {
      if (!toolsMenuRef.current) return;
      if (!toolsMenuRef.current.contains(event.target as Node)) {
        setToolsMenuOpen(false);
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setToolsMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEscape);

    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [toolsMenuOpen]);

  useEffect(() => {
    let cancelled = false;

    async function fetchTrendingSuggestions() {
      try {
        console.log('[UI] Fetching hourly trending suggestions');
        const endpoint =
          process.env.NODE_ENV === 'test' ? 'http://localhost/api/trending-prompts' : '/api/trending-prompts';
        const response = await fetch(endpoint, { method: 'GET', cache: 'no-store' });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const json = (await response.json()) as { suggestions?: string[] };
        const suggestions = Array.isArray(json.suggestions)
          ? json.suggestions.filter((item) => typeof item === 'string' && item.trim().length > 0)
          : [];
        if (!cancelled && suggestions.length > 0) {
          setWelcomeSuggestions(suggestions.slice(0, 4));
          console.log('[UI] Trending suggestions loaded', { count: suggestions.length });
        }
      } catch (error) {
        console.log('[UI] Trending suggestions fetch failed, using fallback', { error });
      }
    }

    void fetchTrendingSuggestions();
    const hourlyTimer = window.setInterval(() => {
      void fetchTrendingSuggestions();
    }, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(hourlyTimer);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
  }

  function getModeLabel(mode: SearchMode) {
    const selected = SEARCH_MODE_OPTIONS.find((option) => option.value === mode);
    if (!selected) {
      console.log('[UI] Unexpected mode value encountered; defaulting to Quick', mode);
      return 'Quick';
    }
    return selected.label;
  }

  function createConversation(title: string): string {
    const newId = String(Date.now());
    const newConversation: Conversation = {
      id: newId,
      title,
      turns: [],
    };
    console.log('[UI] Creating conversation', { id: newId, title });
    setConversations((prev) => [newConversation, ...prev]);
    setActiveConversationId(newId);
    return newId;
  }

  function startNewChat() {
    console.log('[UI] Starting a new chat');
    setActiveConversationId(null);
    setInput('');
    setPendingTurnId(null);
    setSearching(false);
  }

  function onBrandNewChatClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    console.log('[UI] Brand link clicked; starting a new chat');
    startNewChat();
  }

  function renameConversation(conversationId: string, nextTitleRaw: string) {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      console.log('[UI] Rename skipped: conversation not found', { conversationId });
      return;
    }

    const nextTitle = nextTitleRaw.trim();
    if (!nextTitle) {
      console.log('[UI] Rename rejected: empty title', { conversationId });
      showToast('Please enter a non-empty title');
      return;
    }

    if (nextTitle === conversation.title) {
      console.log('[UI] Rename skipped: title unchanged', { conversationId, title: nextTitle });
      return;
    }

    console.log('[UI] Renaming conversation', {
      conversationId,
      previousTitle: conversation.title,
      nextTitle,
    });
    setConversations((prev) =>
      prev.map((item) =>
        item.id === conversationId
          ? {
              ...item,
              title: nextTitle,
            }
          : item,
      ),
    );
    showToast('Recent search renamed');
  }

  function deleteConversation(conversationId: string) {
    const conversationIndex = conversations.findIndex((item) => item.id === conversationId);
    const conversation = conversationIndex >= 0 ? conversations[conversationIndex] : null;
    if (!conversation) {
      console.log('[UI] Delete skipped: conversation not found', { conversationId });
      return;
    }

    const wasActive = conversation.id === activeConversationId;
    console.log('[UI] Deleting conversation from recents', {
      conversationId,
      title: conversation.title,
      conversationIndex,
      wasActive,
    });
    setRecentlyDeletedConversation({
      conversation,
      index: conversationIndex,
      wasActive,
    });

    setConversations((prev) => prev.filter((item) => item.id !== conversationId));
    if (wasActive) {
      const fallbackConversation = conversations.find((item) => item.id !== conversationId);
      setActiveConversationId(fallbackConversation?.id ?? null);
    }
    if (editingConversationId === conversationId) {
      setEditingConversationId(null);
      setEditingConversationTitle('');
    }
    showToast('Recent search deleted. Undo is available in-row.');
  }

  function undoDeleteConversation() {
    if (!recentlyDeletedConversation) {
      console.log('[UI] Undo delete skipped: no recent deleted snapshot available');
      return;
    }

    const { conversation, index, wasActive } = recentlyDeletedConversation;
    console.log('[UI] Undoing recent search deletion', {
      conversationId: conversation.id,
      title: conversation.title,
      insertIndex: index,
      wasActive,
    });
    setConversations((prev) => {
      const insertAt = Math.max(0, Math.min(index, prev.length));
      const next = [...prev];
      next.splice(insertAt, 0, conversation);
      return next;
    });
    if (wasActive) {
      setActiveConversationId(conversation.id);
    }
    setRecentlyDeletedConversation(null);
    showToast('Recent search restored');
  }

  function dismissDeletedConversationRow() {
    if (!recentlyDeletedConversation) return;
    console.log('[UI] Dismissing deleted conversation row', {
      conversationId: recentlyDeletedConversation.conversation.id,
    });
    setRecentlyDeletedConversation(null);
  }

  function beginInlineRename(conversationId: string) {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      console.log('[UI] Inline rename start skipped: conversation not found', { conversationId });
      return;
    }
    console.log('[UI] Inline rename started', { conversationId, title: conversation.title });
    setEditingConversationId(conversationId);
    setEditingConversationTitle(conversation.title);
  }

  function cancelInlineRename() {
    if (!editingConversationId) return;
    console.log('[UI] Inline rename cancelled', { conversationId: editingConversationId });
    setEditingConversationId(null);
    setEditingConversationTitle('');
  }

  function commitInlineRename(conversationId: string) {
    renameConversation(conversationId, editingConversationTitle);
    setEditingConversationId(null);
    setEditingConversationTitle('');
  }

  const hasContext = uploadedFiles.length > 0 || gitSnippets.length > 0;

  function buildContextSummaryText() {
    const parts: string[] = [];
    if (uploadedFiles.length > 0) parts.push(`${uploadedFiles.length} file${uploadedFiles.length === 1 ? '' : 's'}`);
    if (gitSnippets.length > 0) parts.push(`${gitSnippets.length} git snippet${gitSnippets.length === 1 ? '' : 's'}`);
    return parts.join(', ');
  }

  function buildTurnUserText(userText: string) {
    if (!hasContext) return userText;
    const contextSummary = buildContextSummaryText();
    if (!userText) return `Shared context: ${contextSummary}`;
    return `${userText}\n\nAttached context: ${contextSummary}`;
  }

  async function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    console.log('[UI] File upload started', { count: files.length });
    const results = await Promise.allSettled(files.map((file) => normalizeUploadFile(file)));
    const normalized = results
      .filter((result): result is PromiseFulfilledResult<UploadedContextFile> => result.status === 'fulfilled')
      .map((result) => result.value);
    const failures = results.filter((result) => result.status === 'rejected').length;

    if (normalized.length > 0) {
      setUploadedFiles((prev) => [...prev, ...normalized]);
    }
    if (failures > 0) {
      showToast(`Could not read ${failures} file${failures === 1 ? '' : 's'}. Try re-uploading.`);
    }
    console.log('[UI] File upload completed', {
      added: normalized.length,
      kinds: normalized.map((item) => item.contentKind),
      failures,
    });
    event.target.value = '';
  }

  function addGitSnippetContext() {
    const labelRaw = window.prompt('Git file path or label (e.g. src/app.ts)');
    const label = labelRaw?.trim();
    if (!label) return;
    const codeRaw = window.prompt('Paste git code snippet to include');
    const code = codeRaw?.trim();
    if (!code) return;

    setGitSnippets((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        code,
      },
    ]);
    console.log('[UI] Added git snippet context', { label, length: code.length });
  }

  function showMoreRouteInfo() {
    const route = window.location.pathname || '/';
    const turns = activeConversation?.turns.length ?? 0;
    const details = `Route: ${route} · Turns: ${turns} · Mode: ${getModeLabel(searchMode)}`;
    console.log('[UI] More Route Info requested', { route, turns, mode: searchMode });
    showToast(details);
  }

  function renderStructuredAssistantText(text: string) {
    if (!text) return null;
    const blocks = parseMarkdownBlocks(text);

    return (
      <div className="ai-rich" data-testid="assistant-rich-output">
        {blocks.map((block, index) => {
          if (block.type === 'heading') {
            const content = parseInlineMarkdown(block.text, `h-${index}`);
            if (block.level === 1) return <h1 key={`h-${index}`}>{content}</h1>;
            if (block.level === 2) return <h2 key={`h-${index}`}>{content}</h2>;
            if (block.level === 3) return <h3 key={`h-${index}`}>{content}</h3>;
            if (block.level === 4) return <h4 key={`h-${index}`}>{content}</h4>;
            if (block.level === 5) return <h5 key={`h-${index}`}>{content}</h5>;
            return <h6 key={`h-${index}`}>{content}</h6>;
          }

          if (block.type === 'ul') {
            return (
              <ul className="ai-list ai-list-ul" key={`ul-${index}`}>
                {block.items.map((item, itemIndex) => (
                  <li key={`ul-${index}-${itemIndex}`}>
                    {item.match(/^\[( |x|X)\]\s+(.+)$/) ? (
                      <>
                        <input
                          type="checkbox"
                          disabled
                          checked={Boolean(item.match(/^\[(x|X)\]\s+/))}
                          readOnly
                        />
                        <span>{parseInlineMarkdown(item.replace(/^\[( |x|X)\]\s+/, ''), `ul-${index}-${itemIndex}`)}</span>
                      </>
                    ) : (
                      parseInlineMarkdown(item, `ul-${index}-${itemIndex}`)
                    )}
                  </li>
                ))}
              </ul>
            );
          }

          if (block.type === 'ol') {
            return (
              <ol className="ai-list ai-list-ol" key={`ol-${index}`}>
                {block.items.map((item, itemIndex) => (
                  <li key={`ol-${index}-${itemIndex}`}>
                    {parseInlineMarkdown(item, `ol-${index}-${itemIndex}`)}
                  </li>
                ))}
              </ol>
            );
          }

          if (block.type === 'code') {
            return (
              <pre className="ai-code-block" key={`code-${index}`}>
                <code data-language={block.language || undefined}>{block.code}</code>
              </pre>
            );
          }

          if (block.type === 'blockquote') {
            return (
              <blockquote className="ai-blockquote" key={`quote-${index}`}>
                {block.text.split('\n').map((quoteLine, quoteLineIndex) => (
                  <p key={`quote-${index}-${quoteLineIndex}`}>
                    {parseInlineMarkdown(quoteLine, `quote-${index}-${quoteLineIndex}`)}
                  </p>
                ))}
              </blockquote>
            );
          }

          if (block.type === 'hr') {
            return <hr className="ai-hr" key={`hr-${index}`} />;
          }

          if (block.type === 'table') {
            return (
              <div className="ai-table-wrap" key={`table-${index}`}>
                <table className="ai-table">
                  <thead>
                    <tr>
                      {block.headers.map((header, headerIndex) => (
                        <th key={`table-${index}-h-${headerIndex}`}>
                          {parseInlineMarkdown(header, `table-${index}-h-${headerIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`table-${index}-r-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`table-${index}-r-${rowIndex}-c-${cellIndex}`}>
                            {parseInlineMarkdown(cell, `table-${index}-r-${rowIndex}-c-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          return (
            <p className="ai-paragraph" key={`p-${index}`}>
              {parseInlineMarkdown(block.text, `p-${index}`)}
            </p>
          );
        })}
      </div>
    );
  }

  async function streamLikeUpdate(targetTurnId: string, fullText: string) {
    console.log('[UI] Starting simulated stream render', { chars: fullText.length, targetTurnId });
    let rendered = '';
    for (let i = 0; i < fullText.length; i += 12) {
      rendered = fullText.slice(0, i + 12);
      setConversations((prev) =>
        prev.map((conv) => ({
          ...conv,
          turns: conv.turns.map((turn) =>
            turn.id === targetTurnId
              ? {
                  ...turn,
                  assistant: rendered,
                }
              : turn,
          ),
        })),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 6));
    }
    console.log('[UI] Simulated stream render complete', { targetTurnId });
  }

  async function sendMessage(overrideText?: string) {
    if (isLoading) {
      console.log('[UI] sendMessage called while loading, stopping current request');
      abortControllerRef.current?.abort();
      return;
    }

    const userText = (overrideText ?? input).trim();
    if (!userText && !hasContext) return;

    const filesSnapshot = [...uploadedFiles];
    const gitSnippetsSnapshot = [...gitSnippets];
    const renderedUserText = buildTurnUserText(userText);

    console.log('[UI] Sending message', {
      mode: searchMode,
      length: userText.length,
      fileCount: filesSnapshot.length,
      gitSnippetCount: gitSnippetsSnapshot.length,
    });

    setInput('');
    setIsLoading(true);
    setSearching(true);

    const targetConversationId = activeConversationId ?? createConversation(userText || renderedUserText);
    const existingTurns = conversations.find((conv) => conv.id === targetConversationId)?.turns ?? [];
    const historyTurns: HistoryTurnPayload[] = existingTurns.slice(-8).map((turn) => ({
      user: turn.user,
      assistant: turn.assistant || turn.error || '',
      mode: turn.mode,
    }));
    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setPendingTurnId(turnId);

    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === targetConversationId
          ? {
              ...conv,
              turns: [
                ...conv.turns,
                {
                  id: turnId,
                  user: renderedUserText,
                  assistant: '',
                  citations: [],
                  mode: searchMode,
                },
              ],
            }
          : conv,
      ),
    );

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const payload = {
        query: userText,
        mode: searchMode,
        files: filesSnapshot.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          contentKind: file.contentKind,
          contentText: file.contentText,
          contentBase64: file.contentBase64,
          note: file.note,
        })),
        gitSnippets: gitSnippetsSnapshot.map((snippet) => ({
          label: snippet.label,
          code: snippet.code,
        })),
        history: historyTurns,
      };

      console.log('[UI] POST /api/chat request', payload);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const json = (await response.json().catch(() => null)) as
        | { answer?: string; citations?: Citation[]; error?: string; recovery?: string }
        | null;

      if (!response.ok) {
        console.log('[UI] /api/chat returned an error response', { status: response.status, json });
        const details = [json?.error, json?.recovery].filter(Boolean).join(' ');
        throw new Error(details || 'Request failed. Please try again.');
      }

      const answer = json?.answer ?? '';
      const citations = Array.isArray(json?.citations) ? json?.citations : [];

      setSearching(false);
      await streamLikeUpdate(turnId, answer);

      setConversations((prev) =>
        prev.map((conv) => ({
          ...conv,
          turns: conv.turns.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  assistant: answer,
                  citations,
                }
              : turn,
          ),
        })),
      );
      setUploadedFiles([]);
      setGitSnippets([]);

      console.log('[UI] Message completed successfully', {
        turnId,
        answerLength: answer.length,
        citationCount: citations.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      console.log('[UI] sendMessage failed', { message, error });
      setSearching(false);

      setConversations((prev) =>
        prev.map((conv) => ({
          ...conv,
          turns: conv.turns.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  error: message,
                }
              : turn,
          ),
        })),
      );
    } finally {
      setIsLoading(false);
      setPendingTurnId(null);
      abortControllerRef.current = null;
    }
  }

  async function copyLastAssistant() {
    const turns = activeConversation?.turns ?? [];
    const last = turns[turns.length - 1]?.assistant;
    if (!last) return;

    console.log('[UI] Copying last assistant message to clipboard');
    await navigator.clipboard.writeText(last);
    showToast('Copied response to clipboard');
  }

  function regenerate() {
    const turns = activeConversation?.turns ?? [];
    const lastUser = turns[turns.length - 1]?.user;
    if (!lastUser) return;

    console.log('[UI] Regenerate requested');
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === activeConversationId
          ? {
              ...conv,
              turns: conv.turns.slice(0, -1),
            }
          : conv,
      ),
    );
    void sendMessage(lastUser);
  }

  function exportConversationToPdf() {
    const turns = activeConversation?.turns ?? [];
    if (turns.length === 0) {
      console.log('[UI] PDF export skipped: no conversation');
      showToast('Start a conversation before exporting PDF');
      return;
    }

    console.log('[UI] Starting PDF export', {
      conversationId: activeConversation?.id,
      turnCount: turns.length,
    });

    const title = activeConversation?.title || 'New chat';
    const exportedAt = new Date().toLocaleString();
    const printable = buildPrintableConversationHtml(title, turns, exportedAt, getModeLabel);
    const printWindow = window.open('about:blank', '_blank');
    if (!printWindow) {
      console.log('[UI] PDF export failed: popup blocked');
      showToast('Enable popups to export PDF');
      return;
    }

    try {
      if (typeof printWindow.document.open === 'function') {
        printWindow.document.open();
      }
      printWindow.document.write(printable);
      printWindow.document.close();
      printWindow.focus();

      // Safari can show a blank about:blank tab if print is triggered too early.
      let didPrint = false;
      const runPrint = () => {
        if (didPrint) return;
        didPrint = true;
        console.log('[UI] PDF export print dialog requested');
        printWindow.print();
        showToast('Print dialog opened. Choose Save as PDF.');
      };

      if (printWindow.document.readyState === 'complete') {
        window.setTimeout(runPrint, 120);
      } else {
        printWindow.onload = () => window.setTimeout(runPrint, 120);
      }
      window.setTimeout(runPrint, 400);
    } catch (error) {
      console.log('[UI] PDF export failed while writing print window', { error });
      showToast('Unable to render PDF export. Please try again.');
    }
  }

  return (
    <UIErrorBoundary>
      <div className={`search-ui ${isUiBooted ? 'booted' : 'booting'}`} data-testid="search-ui-root">
        <div id="app" data-testid="app-root">
          <header id="app-header" data-testid="app-header">
            <div className="app-header-inner">
              <Link
                href="/"
                className="brand-home-link"
                data-testid="brand-home-link"
                onClick={onBrandNewChatClick}
              >
                <div className="brand-mark" data-testid="brand-mark">
                  <Image src="/lighthouse.svg" alt="Beacon Search lighthouse logo" width={30} height={30} />
                </div>
                <h1>Beacon Search AI</h1>
              </Link>
            </div>
          </header>

          <aside id="sidebar" className={!sidebarOpen ? 'collapsed' : ''} data-testid="sidebar">
            <div id="sidebar-top">
              <button id="new-chat-btn" data-testid="new-chat-btn" type="button" onClick={startNewChat}>
                New chat
              </button>
            </div>
            <div className="sidebar-section-label">Recents</div>
            <div id="conv-list" data-testid="conv-list">
              {conversations.map((conversation, index) => (
                <React.Fragment key={conversation.id}>
                  {recentlyDeletedConversation && recentlyDeletedConversation.index === index ? (
                    <div
                      className="conv-row conv-row-deleted"
                      data-testid={`conversation-deleted-row-${recentlyDeletedConversation.conversation.id}`}
                    >
                      <div className="conv-item conv-item-deleted">
                        Deleted: {recentlyDeletedConversation.conversation.title}
                      </div>
                      <button
                        type="button"
                        className="conv-inline-action"
                        data-testid={`conversation-undo-${recentlyDeletedConversation.conversation.id}`}
                        onClick={undoDeleteConversation}
                      >
                        Undo
                      </button>
                      <button
                        type="button"
                        className="conv-inline-action"
                        data-testid={`conversation-dismiss-${recentlyDeletedConversation.conversation.id}`}
                        onClick={dismissDeletedConversationRow}
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  <div
                    className={`conv-row ${conversation.id === activeConversationId ? 'active' : ''}`}
                    data-testid={`conversation-row-${conversation.id}`}
                  >
                    {editingConversationId === conversation.id ? (
                      <input
                        className="conv-title-input"
                        data-testid={`conversation-edit-${conversation.id}`}
                        value={editingConversationTitle}
                        onChange={(event) => setEditingConversationTitle(event.target.value)}
                        onBlur={() => commitInlineRename(conversation.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitInlineRename(conversation.id);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelInlineRename();
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className={`conv-item ${conversation.id === activeConversationId ? 'active' : ''}`}
                        data-testid={`conversation-open-${conversation.id}`}
                        onClick={() => {
                          if (conversation.id !== activeConversationId) {
                            console.log('[UI] Loading conversation', conversation.id);
                            setActiveConversationId(conversation.id);
                            return;
                          }
                          beginInlineRename(conversation.id);
                        }}
                      >
                        {conversation.title}
                      </button>
                    )}
                    <button
                      type="button"
                      className="conv-row-delete"
                      data-testid={`conversation-delete-${conversation.id}`}
                      onClick={() => deleteConversation(conversation.id)}
                      aria-label={`Delete ${conversation.title}`}
                    >
                      Delete
                    </button>
                  </div>
                </React.Fragment>
              ))}
              {recentlyDeletedConversation && recentlyDeletedConversation.index >= conversations.length ? (
                <div
                  className="conv-row conv-row-deleted"
                  data-testid={`conversation-deleted-row-${recentlyDeletedConversation.conversation.id}`}
                >
                  <div className="conv-item conv-item-deleted">Deleted: {recentlyDeletedConversation.conversation.title}</div>
                  <button
                    type="button"
                    className="conv-inline-action"
                    data-testid={`conversation-undo-${recentlyDeletedConversation.conversation.id}`}
                    onClick={undoDeleteConversation}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className="conv-inline-action"
                    data-testid={`conversation-dismiss-${recentlyDeletedConversation.conversation.id}`}
                    onClick={dismissDeletedConversationRow}
                  >
                    ×
                  </button>
                </div>
              ) : null}
            </div>

            <div id="sidebar-bottom" />
          </aside>

          <main id="main">
            <div id="topbar">
              <button
                id="sidebar-toggle"
                data-testid="sidebar-toggle"
                type="button"
                onClick={() => {
                  console.log('[UI] Sidebar toggle clicked');
                  setSidebarOpen((prev) => !prev);
                }}
              >
                ☰
              </button>
              <span id="chat-title" data-testid="chat-title">
                {activeConversation?.title ?? 'New chat'}
              </span>
              {hasResults ? (
                <button
                  type="button"
                  className="top-action-btn"
                  data-testid="pdf-export-btn"
                  onClick={exportConversationToPdf}
                >
                  Export PDF
                </button>
              ) : null}
            </div>

            {!activeConversation || activeConversation.turns.length === 0 ? (
              <div id="welcome" data-testid="welcome-screen">
                <h1 data-testid="welcome-heading">Ask me anything!</h1>
                <div className="welcome-suggestions">
                  {welcomeSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="suggestion-btn"
                      onClick={() => {
                        console.log('[UI] Suggestion clicked', suggestion);
                        setInput(suggestion);
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div id="messages-wrap" ref={messageWrapRef} data-testid="messages-wrap">
                <div id="messages">
                  {activeConversation.turns.map((turn) => (
                    <div className="msg-group" key={turn.id}>
                      <div className="user-msg">
                        <div className="user-bubble">{turn.user}</div>
                      </div>
                      <div className="ai-msg">
                        <div className="ai-content">
                          {searching && pendingTurnId === turn.id ? (
                            <div className="search-indicator">Searching the web…</div>
                          ) : null}

                          {turn.error ? (
                            <div className="error-bubble" data-testid="assistant-error">
                              {turn.error}
                            </div>
                          ) : (
                            <div className="ai-text">
                              {turn.assistant
                                ? renderStructuredAssistantText(turn.assistant)
                                : pendingTurnId === turn.id
                                  ? 'Thinking…'
                                  : ''}
                            </div>
                          )}

                          <div className="source-bar">
                            <span className={`source-pill mode-${turn.mode}`}>{getModeLabel(turn.mode)}</span>
                          </div>

                          {turn.citations.length > 0 ? (
                            <div className="citations">
                              {turn.citations.slice(0, 5).map((citation, index) => (
                                <a
                                  key={`${citation.url ?? 'cite'}-${index}`}
                                  className="cite-item"
                                  href={citation.url || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <div className="cite-num">{index + 1}</div>
                                  <div className="cite-text">
                                    <div className="cite-title">{citation.title || citation.url || 'Citation'}</div>
                                  </div>
                                </a>
                              ))}
                            </div>
                          ) : null}

                          <div className="action-bar">
                            <button type="button" className="action-btn" onClick={copyLastAssistant}>
                              Copy
                            </button>
                            <button type="button" className="action-btn" onClick={regenerate}>
                              Regenerate
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div id="input-area">
              <div id="input-wrapper">
                <input
                  ref={fileInputRef}
                  data-testid="file-input"
                  className="hidden-file-input"
                  type="file"
                  multiple
                  onChange={onFileInputChange}
                />

                {hasContext ? (
                  <div className="context-chips" data-testid="context-chips">
                    {uploadedFiles.map((file) => (
                      <div className="context-chip" key={file.id}>
                        <span className="context-chip-label">
                          File: {file.name} ({formatBytes(file.size)})
                        </span>
                        <button
                          type="button"
                          className="context-chip-remove"
                          onClick={() => setUploadedFiles((prev) => prev.filter((item) => item.id !== file.id))}
                        >
                          ×
                        </button>
                      </div>
                    ))}

                    {gitSnippets.map((snippet) => (
                      <div className="context-chip" key={snippet.id}>
                        <span className="context-chip-label">Git: {snippet.label}</span>
                        <button
                          type="button"
                          className="context-chip-remove"
                          onClick={() => setGitSnippets((prev) => prev.filter((item) => item.id !== snippet.id))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <textarea
                  id="message-input"
                  data-testid="message-input"
                  value={input}
                  placeholder="Ask anything..."
                  rows={2}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />

                <div id="input-footer">
                  <div className="tools-menu-wrap" ref={toolsMenuRef}>
                    <button
                      type="button"
                      className="tool-dropdown-btn"
                      data-testid="tools-dropdown-btn"
                      aria-haspopup="menu"
                      aria-expanded={toolsMenuOpen}
                      onClick={() => setToolsMenuOpen((prev) => !prev)}
                    >
                      <span className="plus-glyph" aria-hidden="true">
                        +
                      </span>
                    </button>
                    {toolsMenuOpen ? (
                      <div className="tool-dropdown-menu" data-testid="tools-dropdown-menu" role="menu">
                        {SEARCH_MODE_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`tool-dropdown-item ${searchMode === option.value ? 'active' : ''}`}
                            data-testid={`search-mode-option-${option.value}`}
                            onClick={() => {
                              console.log('[UI] Search mode changed', { mode: option.value });
                              setSearchMode(option.value);
                              setToolsMenuOpen(false);
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="tool-dropdown-item"
                          data-testid="upload-files-btn"
                          onClick={() => {
                            fileInputRef.current?.click();
                            setToolsMenuOpen(false);
                          }}
                        >
                          Upload file
                        </button>
                        <button
                          type="button"
                          className="tool-dropdown-item"
                          data-testid="add-git-code-btn"
                          onClick={() => {
                            addGitSnippetContext();
                            setToolsMenuOpen(false);
                          }}
                        >
                          Add git code
                        </button>
                        <button
                          type="button"
                          className="tool-dropdown-item"
                          data-testid="more-route-info-btn"
                          onClick={() => {
                            showMoreRouteInfo();
                            setToolsMenuOpen(false);
                          }}
                        >
                          More Route Info
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div id="input-right">
                    <span id="char-count">{input.length > 200 ? input.length.toLocaleString() : ''}</span>
                    <button
                      id="send-btn"
                      data-testid="send-btn"
                      type="button"
                      disabled={!isLoading && input.trim().length === 0 && !hasContext}
                      className={isLoading ? 'loading' : ''}
                      onClick={() => void sendMessage()}
                    >
                      {isLoading ? (
                        '■'
                      ) : (
                        <span className="send-glyph" aria-hidden="true">
                          ↑
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div id="footer-note">
                <span id="mode-label">{getModeLabel(searchMode)}</span>
              </div>
              <p className="subheader-copy text-xs text-zinc-400 text-center mt-2">
                AI models can make mistakes. Always double check your work. Remember to think critically.
              </p>
            </div>
            <a id="page-bottom-anchor" data-testid="page-bottom-anchor" href="#page-bottom-anchor" aria-label="Bottom of page" />
          </main>
        </div>

        <div id="toast" className={toast ? 'show' : ''} data-testid="toast">
          {toast}
        </div>
      </div>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #ffffff;
          --main-bg: #ffffff;
          --sidebar-bg: #f9f9f9;
          --sidebar-hover: #ececec;
          --sidebar-active: #ececec;
          --input-bg: #ffffff;
          --border: #e5e5e5;
          --text-primary: #0f172a;
          --text-secondary: #374151;
          --text-tertiary: #6b7280;
          --accent: #10a37f;
          --accent-hover: #0e8f70;
          --send-bg: #111111;
          --send-color: #ffffff;
          --radius-sm: 6px;
          --radius-md: 12px;
          --radius-lg: 16px;
          --sidebar-w: 268px;
        }

        html, body, .search-ui {
          height: 100%;
          overflow: hidden;
          background: var(--bg);
          color: var(--text-primary);
          font-family: "Soehne", "Helvetica Neue", Helvetica, Arial, sans-serif;
        }
        .search-ui.booting #app { visibility: hidden; }
        .search-ui.booted #app { visibility: visible; }
        #app { display: flex; height: 100vh; overflow: hidden; padding-top: 56px; position: relative; }
        #app-header {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 56px;
          border-bottom: 1px solid var(--border);
          background: #ffffff;
          z-index: 80;
        }
        .app-header-inner {
          height: 100%;
          display: flex;
          align-items: center;
          padding: 0 14px;
        }
        .brand-home-link {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: inherit;
          text-decoration: none;
        }
        .brand-home-link:focus-visible {
          outline: 2px solid #111111;
          outline-offset: 4px;
          border-radius: 10px;
        }
        .brand-mark {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid #d1d5db;
          background: #ffffff;
          flex: 0 0 auto;
        }
        .brand-mark img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        #app-header h1 {
          font-size: 18px;
          line-height: 1;
          letter-spacing: -0.02em;
          color: var(--text-primary);
        }
        #sidebar {
          width: var(--sidebar-w);
          min-width: var(--sidebar-w);
          background: var(--sidebar-bg);
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border);
        }
        #sidebar.collapsed { width: 0; min-width: 0; overflow: hidden; }
        #sidebar-top { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
        #new-chat-btn, .conv-item, .mode-pill, .action-btn, .suggestion-btn, #send-btn, #sidebar-toggle, .tool-dropdown-btn, .tool-dropdown-item {
          cursor: pointer;
        }
        #new-chat-btn {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 11px;
          background: #ffffff;
          color: var(--text-secondary);
          text-align: left;
          font-weight: 500;
        }
        #new-chat-btn:hover, .conv-item:hover { background: var(--sidebar-hover); color: var(--text-primary); }
        .sidebar-section-label { padding: 10px 14px; font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
        #conv-list { flex: 1; overflow-y: auto; padding: 0 6px 8px; display: flex; flex-direction: column; gap: 4px; }
        .conv-row { display: flex; align-items: center; gap: 6px; }
        .conv-item {
          flex: 1;
          min-width: 0;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .conv-item-deleted {
          color: #9ca3af;
          font-style: italic;
          background: #f3f4f6;
        }
        .conv-item.active { background: var(--sidebar-active); color: var(--text-primary); }
        .conv-row-delete,
        .conv-inline-action {
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #ffffff;
          color: var(--text-secondary);
          padding: 6px 8px;
          font-size: 12px;
          line-height: 1;
          cursor: pointer;
        }
        .conv-row-delete:hover,
        .conv-inline-action:hover {
          background: var(--sidebar-hover);
          color: var(--text-primary);
        }
        .conv-row-deleted {
          border: 1px dashed #d1d5db;
          border-radius: 10px;
          padding: 4px;
        }
        .conv-title-input {
          width: 100%;
          border: 1px solid #94a3b8;
          border-radius: var(--radius-sm);
          background: #ffffff;
          color: var(--text-primary);
          padding: 7px 9px;
          font-size: 14px;
          line-height: 1.3;
          outline: none;
        }
        #sidebar-bottom { padding: 12px; border-top: 1px solid var(--border); position: relative; }
        #main {
          flex: 1;
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--main-bg);
          border-left: 1px solid #ffffff;
        }
        #topbar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid transparent;
          background: #ffffff;
        }
        #sidebar-toggle { background: transparent; border: none; color: var(--text-secondary); }
        #chat-title { flex: 1; min-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
        .top-action-btn {
          border: 1px solid var(--border);
          background: #ffffff;
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 7px 12px;
          font-size: 13px;
          cursor: pointer;
        }
        .top-action-btn:hover { border-color: #d1d5db; background: #f9fafb; color: var(--text-primary); }

        #welcome {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 28px 24px 8px;
          gap: 28px;
        }
        #welcome h1 { font-size: 40px; line-height: 1.1; letter-spacing: -0.02em; font-weight: 600; }
        .welcome-suggestions {
          width: 100%;
          max-width: 780px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .suggestion-btn {
          border: 1px solid #ececec;
          background: #ffffff;
          color: #303030;
          border-radius: var(--radius-md);
          padding: 14px 16px 16px;
          text-align: left;
          min-height: 90px;
          font-size: 15px;
          line-height: 1.48;
        }
        .suggestion-btn:hover { background: #f9fafb; color: var(--text-primary); border-color: #d1d5db; }

        #messages-wrap { flex: 1; min-height: 0; overflow-y: auto; }
        #messages { max-width: 840px; margin: 0 auto; padding: 22px 20px; }
        .msg-group { padding: 12px 0; }
        .user-msg { display: flex; justify-content: flex-end; margin-bottom: 12px; }
        .user-bubble {
          max-width: 80%;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: var(--radius-lg) var(--radius-lg) 4px var(--radius-lg);
          padding: 12px 14px;
          white-space: pre-wrap;
        }
        .ai-msg { display: flex; }
        .ai-content { width: 100%; }
        .ai-text {
          line-height: 1.72;
          font-size: 16px;
          color: #111827;
        }
        .ai-rich { display: flex; flex-direction: column; gap: 10px; }
        .ai-paragraph { margin: 0; color: #111827; }
        .ai-rich h1, .ai-rich h2, .ai-rich h3, .ai-rich h4, .ai-rich h5, .ai-rich h6 {
          color: var(--text-primary);
          font-weight: 700;
          line-height: 1.25;
          margin: 2px 0 0;
        }
        .ai-rich h1 { font-size: 1.55rem; }
        .ai-rich h2 { font-size: 1.4rem; }
        .ai-rich h3 { font-size: 1.24rem; }
        .ai-rich h4 { font-size: 1.12rem; }
        .ai-rich h5, .ai-rich h6 { font-size: 1rem; }
        .ai-rich p { margin: 0; }
        .ai-rich a { color: #0f766e; text-decoration: underline; text-underline-offset: 2px; }
        .ai-rich a:hover { color: #0d9488; }
        .ai-rich code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
          font-size: 0.92em;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 1px 6px;
        }
        .ai-code-block {
          margin: 0;
          border: 1px solid #e5e7eb;
          background: #f8fafc;
          border-radius: 10px;
          padding: 12px 14px;
          overflow-x: auto;
        }
        .ai-code-block code {
          display: block;
          background: transparent;
          border: none;
          border-radius: 0;
          padding: 0;
          white-space: pre;
        }
        .ai-blockquote {
          margin: 0;
          padding: 8px 12px;
          border-left: 3px solid #cbd5e1;
          color: #374151;
          background: #f8fafc;
        }
        .ai-blockquote p + p { margin-top: 8px; }
        .ai-hr {
          border: none;
          height: 1px;
          background: #e5e7eb;
          margin: 2px 0;
        }
        .ai-list {
          margin: 0;
          padding-left: 22px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ai-list li { color: #111827; }
        .ai-list li input[type="checkbox"] { margin-right: 8px; }
        .ai-list-ol { list-style-type: decimal; }
        .ai-list-ul { list-style-type: disc; }
        .ai-table-wrap { overflow-x: auto; }
        .ai-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
          border: 1px solid #e5e7eb;
        }
        .ai-table th, .ai-table td {
          border: 1px solid #e5e7eb;
          padding: 7px 9px;
          text-align: left;
          vertical-align: top;
        }
        .ai-table th { background: #f8fafc; color: #111827; font-weight: 600; }
        .search-indicator { color: var(--accent); font-size: 13px; margin-bottom: 8px; font-weight: 600; }
        .source-bar { margin-top: 10px; display: flex; gap: 6px; }
        .source-pill { font-size: 11px; border-radius: 20px; padding: 2px 9px; border: 1px solid #e5e7eb; color: #374151; background: #f9fafb; }
        .citations { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
        .cite-item {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          text-decoration: none;
          color: inherit;
          background: #ffffff;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
        }
        .cite-item:hover { border-color: #d1d5db; background: #f9fafb; }
        .cite-num { width: 18px; height: 18px; border-radius: 50%; background: #e5e7eb; display: flex; align-items: center; justify-content: center; font-size: 10px; }
        .cite-title { font-size: 12px; }
        .action-bar { margin-top: 8px; display: flex; gap: 6px; }
        .action-btn { border: none; color: var(--text-tertiary); background: transparent; padding: 4px 8px; border-radius: var(--radius-sm); }
        .action-btn:hover { background: #f3f4f6; color: var(--text-secondary); }
        .error-bubble { background: #fff3f3; border: 1px solid #f7cccc; border-radius: var(--radius-md); padding: 10px 12px; color: #c53030; }

        #input-area {
          flex: 0 0 auto;
          border-top: 1px solid transparent;
          padding: 40px 20px 0;
          background: #ffffff;
        }
        #page-bottom-anchor {
          display: block;
          width: 100%;
          height: 16px;
          pointer-events: none;
        }
        #input-wrapper {
          max-width: 840px;
          width: 100%;
          margin: 0 auto;
          background: var(--input-bg);
          border: 1px solid #e7e7e7;
          border-radius: 28px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: 0 8px 28px rgba(16, 24, 40, 0.05);
        }
        .hidden-file-input { display: none; }
        .context-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .context-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #d1d5db;
          border-radius: 999px;
          background: #f8fafc;
          color: #334155;
          max-width: 100%;
          padding: 4px 9px;
        }
        .context-chip-label {
          max-width: 340px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 12px;
        }
        .context-chip-remove {
          border: none;
          background: transparent;
          color: #64748b;
          cursor: pointer;
          line-height: 1;
          font-size: 14px;
        }
        .context-chip-remove:hover { color: #0f172a; }
        #message-input {
          width: 100%;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          resize: none;
          min-height: 52px;
          max-height: 240px;
          font-size: 15px;
          font-weight: 500;
          line-height: 1.5;
          padding: 8px 10px 2px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
          overflow-x: hidden;
        }
        #message-input::placeholder { color: #9ca3af; font-size: 15px; font-weight: 600; }
        #input-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 0; }
        .tools-menu-wrap { position: relative; }
        .tool-dropdown-btn {
          border: 1px solid #ececec;
          background: #f4f4f4;
          color: #0f172a;
          border-radius: 999px;
          width: 34px;
          height: 34px;
          justify-content: center;
          padding: 0;
          display: inline-flex;
          align-items: center;
          gap: 0;
          position: relative;
        }
        .plus-glyph {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          line-height: 1;
          font-weight: 400;
          transform: translateY(-1px);
          pointer-events: none;
        }
        .tool-dropdown-btn:hover { background: #efefef; border-color: #dbdbdb; }
        .tool-dropdown-menu {
          position: absolute;
          left: 0;
          bottom: calc(100% + 8px);
          min-width: 220px;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          background: #ffffff;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
          padding: 6px;
          z-index: 120;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .tool-dropdown-item {
          border: none;
          background: transparent;
          color: #0f172a;
          text-align: left;
          font-size: 13px;
          padding: 9px 10px;
          border-radius: 8px;
        }
        .tool-dropdown-item:hover { background: #f8fafc; }
        .tool-dropdown-item.active {
          background: #ecfdf5;
          color: #047857;
          font-weight: 600;
        }
        #input-right { display: flex; align-items: center; gap: 8px; }
        #char-count { font-size: 11px; color: var(--text-tertiary); }
        #send-btn {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: none;
          background: var(--send-bg);
          color: var(--send-color);
          font-size: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .send-glyph {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          line-height: 1;
          font-weight: 700;
          transform: translateY(-1px);
          pointer-events: none;
        }
        #send-btn:hover { background: #000000; }
        #send-btn:disabled { background: #e5e7eb; color: #9ca3af; cursor: not-allowed; }
        #footer-note { max-width: 760px; margin: 10px auto 0; font-size: 12px; color: var(--text-tertiary); text-align: center; }
        .subheader-copy { padding-top: 25px; }

        #toast { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: #111827; border: 1px solid #111827; border-radius: var(--radius-md); padding: 9px 18px; font-size: 13px; color: #ffffff; z-index: 200; opacity: 0; transition: opacity .25s; pointer-events: none; box-shadow: 0 10px 24px rgba(15,23,42,0.2); }
        #toast.show { opacity: 1; }

        .boundary-fallback { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--main-bg); color: var(--text-primary); padding: 24px; }
        .boundary-actions { display: flex; gap: 8px; }
        .boundary-actions button { border: 1px solid var(--border); border-radius: var(--radius-sm); background: #ffffff; color: var(--text-primary); padding: 8px 10px; }

        ::view-transition-group(*),
        ::view-transition-old(*),
        ::view-transition-new(*) {
          animation-duration: 0.25s;
          animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1);
        }

        @media (max-width: 640px) {
          #sidebar { position: fixed; top: 0; left: 0; bottom: 0; z-index: 60; transform: translateX(-100%); }
          #sidebar:not(.collapsed) { transform: translateX(0); }
          #topbar { padding: 10px 12px; }
          #chat-title { min-width: 0; width: 100%; order: 2; }
          .top-action-btn { order: 4; width: 100%; border-radius: 12px; }
          #input-area { padding: 14px 10px 16px; }
          #input-wrapper { padding: 10px 12px; border-radius: 14px; }
          .tool-dropdown-btn { max-width: 100%; }
          .tool-dropdown-menu { left: 0; right: auto; min-width: min(220px, calc(100vw - 30px)); }
          #input-footer { gap: 8px; }
          #welcome h1 { font-size: 30px; text-align: center; }
          .welcome-suggestions { grid-template-columns: 1fr; }
        }
      `}</style>
    </UIErrorBoundary>
  );
}
