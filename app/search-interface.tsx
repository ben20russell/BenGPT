'use client';

import React, { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

type SearchMode = 'auto' | 'web' | 'enterprise';
type ApiSearchMode = 'quick' | 'agentic' | 'deep';
type ModelId = 'gpt-5' | 'gpt-4.1' | 'gpt-4o';

type Citation = {
  url?: string;
  title?: string;
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

type BoundaryState = {
  hasError: boolean;
  message: string;
};

const MODELS: Record<ModelId, { label: string; supportsSearch: boolean }> = {
  'gpt-5': { label: 'GPT-5', supportsSearch: true },
  'gpt-4.1': { label: 'GPT-4.1', supportsSearch: true },
  'gpt-4o': { label: 'GPT-4o', supportsSearch: false },
};

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

function modeToApiMode(mode: SearchMode): ApiSearchMode {
  if (mode === 'web') return 'deep';
  if (mode === 'enterprise') return 'agentic';
  return 'quick';
}

export default function SearchInterface() {
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return sessionStorage.getItem('oai_key') ?? '';
  });
  const [keyOverlayOpen, setKeyOverlayOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return !(sessionStorage.getItem('oai_key') ?? '');
  });
  const [rememberKey, setRememberKey] = useState(false);
  const [toast, setToast] = useState('');

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState<ModelId>('gpt-5');
  const [currentMode, setCurrentMode] = useState<SearchMode>('auto');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messageWrapRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  useEffect(() => {
    console.log('[UI] Component mounted');
  }, []);

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

  function showToast(message: string) {
    setToast(message);
  }

  function submitKey() {
    console.log('[UI] submitKey requested');
    const trimmed = apiKey.trim();
    if (!trimmed || !trimmed.startsWith('sk-')) {
      console.log('[UI] API key rejected by validation');
      showToast('Enter a valid OpenAI API key (starts with sk-)');
      return;
    }

    if (rememberKey) {
      console.log('[UI] Remembering key in session storage');
      sessionStorage.setItem('oai_key', trimmed);
    }

    console.log('[UI] API key accepted, hiding overlay');
    setKeyOverlayOpen(false);
  }

  function getModeLabel(mode: SearchMode) {
    if (mode === 'web') return 'Web search active';
    if (mode === 'enterprise') return 'Docs mode';
    return 'Auto-routing enabled';
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

  function newChat() {
    console.log('[UI] Starting a new chat');
    setActiveConversationId(null);
    setInput('');
    setPendingTurnId(null);
    setSearching(false);
  }

  function cycleTool() {
    const modes: SearchMode[] = ['auto', 'web', 'enterprise'];
    const next = modes[(modes.indexOf(currentMode) + 1) % modes.length];
    console.log('[UI] Cycling tool mode', { from: currentMode, to: next });
    setCurrentMode(next);
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
    if (!userText) return;
    if (keyOverlayOpen) {
      showToast('Connect your API key before sending.');
      return;
    }

    console.log('[UI] Sending message', {
      model: currentModel,
      mode: currentMode,
      length: userText.length,
    });

    setInput('');
    setIsLoading(true);
    setSearching(currentMode === 'web' || currentMode === 'auto');

    const targetConversationId = activeConversationId ?? createConversation(userText);
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
                  user: userText,
                  assistant: '',
                  citations: [],
                  mode: currentMode,
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
        message: userText,
        searchMode: modeToApiMode(currentMode),
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
        throw new Error(json?.error ?? 'Request failed. Please try again.');
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

  return (
    <UIErrorBoundary>
      <div className="search-ui" data-testid="search-ui-root">
        {keyOverlayOpen ? (
          <div id="key-overlay" data-testid="key-overlay">
            <div id="key-modal">
              <h2>Connect to OpenAI</h2>
              <p>Enter your API key to start searching</p>
              <input
                id="key-input"
                data-testid="key-input"
                type="password"
                value={apiKey}
                placeholder="sk-proj-..."
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitKey();
                }}
              />
              <label className="remember-row" htmlFor="key-remember">
                <input
                  id="key-remember"
                  data-testid="key-remember"
                  type="checkbox"
                  checked={rememberKey}
                  onChange={(event) => setRememberKey(event.target.checked)}
                />
                Remember for this session
              </label>
              <button id="key-submit" data-testid="key-submit" type="button" onClick={submitKey}>
                Connect →
              </button>
              <p className="modal-note">Your key stays in your browser session.</p>
            </div>
          </div>
        ) : null}

        <div id="app" data-testid="app-root" style={{ display: keyOverlayOpen ? 'none' : 'flex' }}>
          <aside id="sidebar" className={!sidebarOpen ? 'collapsed' : ''} data-testid="sidebar">
            <div id="sidebar-top">
              <button id="new-chat-btn" data-testid="new-chat-btn" type="button" onClick={newChat}>
                New chat
              </button>
            </div>
            <div className="sidebar-section-label">Recent</div>
            <div id="conv-list" data-testid="conv-list">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conv-item ${conversation.id === activeConversationId ? 'active' : ''}`}
                  onClick={() => {
                    console.log('[UI] Loading conversation', conversation.id);
                    setActiveConversationId(conversation.id);
                  }}
                >
                  {conversation.title}
                </button>
              ))}
            </div>

            <div id="sidebar-bottom">
              {modelDropdownOpen ? (
                <div className="model-dropdown open" data-testid="model-dropdown">
                  {(Object.keys(MODELS) as ModelId[]).map((model) => (
                    <button
                      key={model}
                      type="button"
                      className={`model-option ${currentModel === model ? 'selected' : ''}`}
                      onClick={() => {
                        console.log('[UI] Model selected', model);
                        setCurrentModel(model);
                        setModelDropdownOpen(false);
                      }}
                    >
                      {MODELS[model].label}
                    </button>
                  ))}
                </div>
              ) : null}

              <button
                className="model-selector"
                data-testid="model-selector"
                type="button"
                onClick={() => setModelDropdownOpen((prev) => !prev)}
              >
                {MODELS[currentModel].label}
              </button>
            </div>
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
              <span id="chat-title">{activeConversation?.title ?? 'New chat'}</span>
              <div id="mode-pills" data-testid="mode-pills">
                {(['auto', 'web', 'enterprise'] as SearchMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`mode-pill ${currentMode === mode ? 'active' : ''}`}
                    data-testid={`mode-${mode}`}
                    onClick={() => {
                      console.log('[UI] Mode selected', mode);
                      setCurrentMode(mode);
                    }}
                  >
                    {mode === 'enterprise' ? 'Docs' : mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {!activeConversation || activeConversation.turns.length === 0 ? (
              <div id="welcome" data-testid="welcome-screen">
                <h1>What can I help with?</h1>
                <div className="welcome-suggestions">
                  {[
                    'Search the web for the latest AI news this week',
                    'What are the current trends in B2B SaaS marketing?',
                    'Give me a deep research report on agentic AI for enterprise',
                    'Compare voice AI platforms: RingCentral vs Dialpad vs Cisco',
                  ].map((suggestion) => (
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
                            <div className="ai-text">{turn.assistant || (pendingTurnId === turn.id ? 'Thinking…' : '')}</div>
                          )}

                          <div className="source-bar">
                            <span className={`source-pill ${turn.mode === 'web' ? 'web' : turn.mode === 'enterprise' ? 'enterprise' : 'auto'}`}>
                              {turn.mode === 'web' ? 'Web search' : turn.mode === 'enterprise' ? 'Docs mode' : 'Auto-routed'}
                            </span>
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
                <textarea
                  id="message-input"
                  data-testid="message-input"
                  value={input}
                  placeholder="Message GPT…"
                  rows={1}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />

                <div id="input-footer">
                  <button type="button" className="tool-btn" onClick={cycleTool}>
                    Search
                  </button>

                  <div id="input-right">
                    <span id="char-count">{input.length > 200 ? input.length.toLocaleString() : ''}</span>
                    <button
                      id="send-btn"
                      data-testid="send-btn"
                      type="button"
                      disabled={!isLoading && (input.trim().length === 0 || keyOverlayOpen)}
                      className={isLoading ? 'loading' : ''}
                      onClick={() => void sendMessage()}
                    >
                      {isLoading ? '■' : '↑'}
                    </button>
                  </div>
                </div>
              </div>
              <div id="footer-note">
                {MODELS[currentModel].label} · <span id="mode-label">{getModeLabel(currentMode)}</span>
              </div>
            </div>
          </main>
        </div>

        <div id="toast" className={toast ? 'show' : ''} data-testid="toast">
          {toast}
        </div>
      </div>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --sidebar-bg: #171717;
          --sidebar-hover: #2a2a2a;
          --sidebar-active: #212121;
          --main-bg: #212121;
          --input-bg: #2f2f2f;
          --border: rgba(255,255,255,0.08);
          --text-primary: #ececec;
          --text-secondary: #a0a0a0;
          --text-tertiary: #6b6b6b;
          --accent: #10a37f;
          --accent-hover: #0d9070;
          --send-bg: #ececec;
          --send-color: #212121;
          --radius-sm: 6px;
          --radius-md: 12px;
          --radius-lg: 18px;
          --sidebar-w: 260px;
        }

        html, body, .search-ui { height: 100%; overflow: hidden; background: var(--main-bg); color: var(--text-primary); font-family: -apple-system, ui-sans-serif, system-ui, sans-serif; }
        #app { display: flex; height: 100vh; overflow: hidden; }
        #sidebar { width: var(--sidebar-w); min-width: var(--sidebar-w); background: var(--sidebar-bg); display: flex; flex-direction: column; border-right: 1px solid var(--border); }
        #sidebar.collapsed { width: 0; min-width: 0; overflow: hidden; }
        #sidebar-top { padding: 10px; }
        #new-chat-btn, .conv-item, .model-selector, .mode-pill, .tool-btn, .action-btn, .suggestion-btn, #send-btn, #sidebar-toggle, #key-submit {
          cursor: pointer;
        }
        #new-chat-btn { width: 100%; padding: 10px 12px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); text-align: left; }
        #new-chat-btn:hover, .conv-item:hover { background: var(--sidebar-hover); color: var(--text-primary); }
        .sidebar-section-label { padding: 10px 14px; font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; }
        #conv-list { flex: 1; overflow-y: auto; padding: 0 6px 8px; display: flex; flex-direction: column; gap: 4px; }
        .conv-item { border: none; background: transparent; color: var(--text-secondary); padding: 8px 10px; border-radius: var(--radius-sm); text-align: left; }
        .conv-item.active { background: var(--sidebar-active); color: var(--text-primary); }
        #sidebar-bottom { padding: 8px; border-top: 1px solid var(--border); position: relative; }
        .model-selector, .model-option { width: 100%; border: 1px solid var(--border); background: var(--sidebar-active); color: var(--text-primary); border-radius: var(--radius-sm); padding: 9px 10px; }
        .model-dropdown { position: absolute; bottom: 62px; left: 8px; right: 8px; display: flex; flex-direction: column; gap: 4px; background: #313131; border: 1px solid var(--border); padding: 8px; border-radius: var(--radius-md); }
        .model-option.selected { outline: 1px solid var(--accent); }

        #main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        #topbar { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
        #sidebar-toggle { background: transparent; border: none; color: var(--text-secondary); }
        #chat-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #mode-pills { display: flex; gap: 3px; padding: 3px; border-radius: 20px; border: 1px solid var(--border); }
        .mode-pill { border: none; background: transparent; color: var(--text-secondary); padding: 4px 12px; border-radius: 20px; }
        .mode-pill.active { color: var(--text-primary); background: rgba(255,255,255,0.1); }

        #welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; gap: 20px; }
        #welcome h1 { font-size: 24px; }
        .welcome-suggestions { width: 100%; max-width: 620px; display: flex; flex-direction: column; gap: 8px; }
        .suggestion-btn { border: 1px solid var(--border); background: var(--input-bg); color: var(--text-secondary); border-radius: var(--radius-md); padding: 12px 14px; text-align: left; }
        .suggestion-btn:hover { background: var(--sidebar-hover); color: var(--text-primary); }

        #messages-wrap { flex: 1; overflow-y: auto; }
        #messages { max-width: 760px; margin: 0 auto; padding: 16px 20px; }
        .msg-group { padding: 12px 0; }
        .user-msg { display: flex; justify-content: flex-end; margin-bottom: 12px; }
        .user-bubble { max-width: 85%; background: var(--input-bg); border-radius: var(--radius-lg) var(--radius-lg) 4px var(--radius-lg); padding: 12px 14px; white-space: pre-wrap; }
        .ai-msg { display: flex; }
        .ai-content { width: 100%; }
        .ai-text { white-space: pre-wrap; line-height: 1.7; }
        .search-indicator { color: var(--text-tertiary); font-size: 13px; margin-bottom: 8px; }
        .source-bar { margin-top: 10px; display: flex; gap: 6px; }
        .source-pill { font-size: 11px; border-radius: 20px; padding: 2px 8px; border: 1px solid var(--border); }
        .source-pill.web { color: #10a37f; border-color: rgba(16,163,127,0.3); }
        .source-pill.enterprise { color: #e6a817; border-color: rgba(230,168,23,0.3); }
        .source-pill.auto { color: #a78bfa; border-color: rgba(167,139,250,0.3); }
        .citations { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
        .cite-item { display: flex; align-items: flex-start; gap: 7px; text-decoration: none; color: inherit; background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; }
        .cite-num { width: 18px; height: 18px; border-radius: 50%; background: rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; font-size: 10px; }
        .cite-title { font-size: 12px; }
        .action-bar { margin-top: 8px; display: flex; gap: 6px; }
        .action-btn { border: none; color: var(--text-tertiary); background: transparent; padding: 4px 8px; border-radius: var(--radius-sm); }
        .action-btn:hover { background: rgba(255,255,255,0.08); color: var(--text-secondary); }
        .error-bubble { background: rgba(220,40,40,.08); border: 1px solid rgba(220,40,40,.2); border-radius: var(--radius-md); padding: 10px 12px; color: #f87171; }

        #input-area { border-top: 1px solid var(--border); padding: 12px 16px 16px; }
        #input-wrapper { max-width: 760px; margin: 0 auto; background: var(--input-bg); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
        #message-input { width: 100%; background: transparent; border: none; outline: none; color: var(--text-primary); resize: none; min-height: 28px; max-height: 200px; }
        #input-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .tool-btn { border: none; color: var(--text-tertiary); background: transparent; padding: 5px 7px; border-radius: var(--radius-sm); }
        #input-right { display: flex; align-items: center; gap: 8px; }
        #char-count { font-size: 11px; color: var(--text-tertiary); }
        #send-btn { width: 34px; height: 34px; border-radius: 50%; border: none; background: var(--send-bg); color: var(--send-color); }
        #send-btn:disabled { background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.4); cursor: not-allowed; }
        #footer-note { max-width: 760px; margin: 10px auto 0; font-size: 12px; color: var(--text-tertiary); text-align: center; }

        #key-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 24px; }
        #key-modal { width: 100%; max-width: 420px; background: #2f2f2f; border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
        #key-modal h2 { margin-bottom: 6px; }
        #key-modal p { color: var(--text-secondary); margin-bottom: 16px; }
        #key-input { width: 100%; border: 1px solid var(--border); background: #171717; color: var(--text-primary); border-radius: var(--radius-md); padding: 10px 12px; margin-bottom: 10px; }
        .remember-row { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; margin-bottom: 12px; }
        #key-submit { width: 100%; border: none; border-radius: var(--radius-md); padding: 10px; background: var(--accent); color: white; font-weight: 600; }
        #key-submit:hover { background: var(--accent-hover); }
        .modal-note { margin-top: 10px; font-size: 11px; color: var(--text-tertiary); text-align: center; }

        #toast { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: #3a3a3a; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 9px 18px; font-size: 13px; color: var(--text-primary); z-index: 200; opacity: 0; transition: opacity .25s; pointer-events: none; }
        #toast.show { opacity: 1; }

        .boundary-fallback { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--main-bg); color: var(--text-primary); padding: 24px; }
        .boundary-actions { display: flex; gap: 8px; }
        .boundary-actions button { border: 1px solid var(--border); border-radius: var(--radius-sm); background: #2f2f2f; color: var(--text-primary); padding: 8px 10px; }

        @media (max-width: 640px) {
          #sidebar { position: fixed; top: 0; left: 0; bottom: 0; z-index: 60; transform: translateX(-100%); }
          #sidebar:not(.collapsed) { transform: translateX(0); }
        }
      `}</style>
    </UIErrorBoundary>
  );
}
