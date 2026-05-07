'use client';

import React, { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

type SearchMode = 'auto' | 'web' | 'enterprise';
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

export default function SearchInterface() {
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
        query: userText,
        forceMode: currentMode === 'auto' ? null : currentMode,
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
        <div id="app" data-testid="app-root">
          <header id="app-header" data-testid="app-header">
            <div className="app-header-inner">
              <h1>SearchAI</h1>
            </div>
          </header>

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
                  placeholder="Ask anything..."
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
                      disabled={!isLoading && input.trim().length === 0}
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
          --bg: #f8f5ef;
          --main-bg: #fcfaf6;
          --sidebar-bg: #f4efe5;
          --sidebar-hover: #ece5d8;
          --sidebar-active: #e8decc;
          --input-bg: #fdfbf8;
          --border: #e4dccf;
          --text-primary: #2f2922;
          --text-secondary: #5a4f43;
          --text-tertiary: #857768;
          --accent: #b66a2d;
          --accent-hover: #9e5b24;
          --send-bg: #2f2922;
          --send-color: #ffffff;
          --radius-sm: 6px;
          --radius-md: 12px;
          --radius-lg: 16px;
          --sidebar-w: 268px;
        }

        html, body, .search-ui {
          height: 100%;
          overflow: hidden;
          background:
            radial-gradient(circle at 18% -18%, rgba(182, 106, 45, 0.08), transparent 52%),
            radial-gradient(circle at 96% -14%, rgba(164, 122, 91, 0.08), transparent 40%),
            var(--bg);
          color: var(--text-primary);
          font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        }
        #app { display: flex; height: 100vh; overflow: hidden; padding-top: 56px; position: relative; }
        #app-header {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 56px;
          border-bottom: 1px solid var(--border);
          background: rgba(252, 250, 246, 0.92);
          backdrop-filter: saturate(160%) blur(10px);
          z-index: 80;
        }
        .app-header-inner {
          height: 100%;
          display: flex;
          align-items: center;
          padding: 0 16px;
          max-width: 1200px;
          margin: 0 auto;
        }
        #app-header h1 {
          font-size: 18px;
          line-height: 1;
          letter-spacing: -0.02em;
          color: #2f2922;
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
        #sidebar-top { padding: 14px; }
        #new-chat-btn, .conv-item, .model-selector, .mode-pill, .tool-btn, .action-btn, .suggestion-btn, #send-btn, #sidebar-toggle {
          cursor: pointer;
        }
        #new-chat-btn {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 11px;
          background: #faf7f1;
          color: var(--text-secondary);
          text-align: left;
          font-weight: 500;
        }
        #new-chat-btn:hover, .conv-item:hover { background: var(--sidebar-hover); color: var(--text-primary); }
        .sidebar-section-label { padding: 10px 14px; font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
        #conv-list { flex: 1; overflow-y: auto; padding: 0 6px 8px; display: flex; flex-direction: column; gap: 4px; }
        .conv-item { border: none; background: transparent; color: var(--text-secondary); padding: 8px 10px; border-radius: var(--radius-sm); text-align: left; }
        .conv-item.active { background: var(--sidebar-active); color: var(--text-primary); }
        #sidebar-bottom { padding: 12px; border-top: 1px solid var(--border); position: relative; }
        .model-selector, .model-option {
          width: 100%;
          border: 1px solid var(--border);
          background: #fdfbf8;
          color: var(--text-primary);
          border-radius: 10px;
          padding: 9px 10px;
        }
        .model-dropdown {
          position: absolute;
          bottom: 62px;
          left: 12px;
          right: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: #ffffff;
          border: 1px solid var(--border);
          padding: 8px;
          border-radius: var(--radius-md);
          box-shadow: 0 12px 28px rgba(59, 46, 35, 0.12);
        }
        .model-option.selected { outline: 1px solid var(--accent); }

        #main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--main-bg);
          border-left: 1px solid rgba(255,255,255,0.55);
        }
        #topbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
          background: rgba(252, 250, 246, 0.9);
          backdrop-filter: saturate(160%) blur(14px);
        }
        #sidebar-toggle { background: transparent; border: none; color: var(--text-secondary); }
        #chat-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
        #mode-pills { display: flex; gap: 3px; padding: 3px; border-radius: 20px; border: 1px solid var(--border); background: #f8f3ea; }
        .mode-pill { border: none; background: transparent; color: var(--text-secondary); padding: 4px 12px; border-radius: 20px; }
        .mode-pill.active { color: #fff; background: #7a6047; }

        #welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; gap: 20px; }
        #welcome h1 { font-size: 36px; line-height: 1.1; letter-spacing: -0.02em; font-weight: 600; }
        .welcome-suggestions {
          width: 100%;
          max-width: 700px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .suggestion-btn {
          border: 1px solid var(--border);
          background: linear-gradient(180deg, #fefcf9, #f7f0e4);
          color: var(--text-secondary);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          text-align: left;
          min-height: 84px;
          line-height: 1.35;
        }
        .suggestion-btn:hover { background: #f2eadc; color: var(--text-primary); border-color: #d8ccb9; }

        #messages-wrap { flex: 1; overflow-y: auto; }
        #messages { max-width: 840px; margin: 0 auto; padding: 22px 20px; }
        .msg-group { padding: 12px 0; }
        .user-msg { display: flex; justify-content: flex-end; margin-bottom: 12px; }
        .user-bubble {
          max-width: 80%;
          background: #f3ebdf;
          border: 1px solid #e2d7c5;
          border-radius: var(--radius-lg) var(--radius-lg) 4px var(--radius-lg);
          padding: 12px 14px;
          white-space: pre-wrap;
        }
        .ai-msg { display: flex; }
        .ai-content { width: 100%; }
        .ai-text {
          white-space: pre-wrap;
          line-height: 1.72;
          font-size: 16px;
          color: #3a3128;
        }
        .search-indicator { color: #8c5a2f; font-size: 13px; margin-bottom: 8px; font-weight: 600; }
        .source-bar { margin-top: 10px; display: flex; gap: 6px; }
        .source-pill { font-size: 11px; border-radius: 20px; padding: 2px 9px; border: 1px solid var(--border); background: #f9f3e9; }
        .source-pill.web { color: #6b4c2f; border-color: #dccab4; background: #f7efe2; }
        .source-pill.enterprise { color: #7a5a2e; border-color: #e0ceb2; background: #f8efdf; }
        .source-pill.auto { color: #5f5448; border-color: #ddd2c2; background: #f3ece1; }
        .citations { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
        .cite-item {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          text-decoration: none;
          color: inherit;
          background: #fbf7f0;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
        }
        .cite-item:hover { border-color: #d9ceb9; background: #f6efe3; }
        .cite-num { width: 18px; height: 18px; border-radius: 50%; background: #eee4d5; display: flex; align-items: center; justify-content: center; font-size: 10px; }
        .cite-title { font-size: 12px; }
        .action-bar { margin-top: 8px; display: flex; gap: 6px; }
        .action-btn { border: none; color: var(--text-tertiary); background: transparent; padding: 4px 8px; border-radius: var(--radius-sm); }
        .action-btn:hover { background: #eee4d5; color: var(--text-secondary); }
        .error-bubble { background: #fff3f3; border: 1px solid #f7cccc; border-radius: var(--radius-md); padding: 10px 12px; color: #c53030; }

        #input-area {
          border-top: 1px solid var(--border);
          padding: 14px 16px 20px;
          background: linear-gradient(180deg, rgba(252,250,246,0), rgba(252,250,246,0.95) 40%);
        }
        #input-wrapper {
          max-width: 840px;
          margin: 0 auto;
          background: var(--input-bg);
          border: 1px solid #dfd3c2;
          border-radius: 20px;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: 0 8px 22px rgba(67, 48, 30, 0.1);
        }
        #message-input {
          width: 100%;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          resize: none;
          min-height: 28px;
          max-height: 200px;
          font-size: 16px;
          line-height: 1.5;
        }
        #message-input::placeholder { color: #978778; }
        #input-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .tool-btn { border: none; color: var(--text-tertiary); background: transparent; padding: 5px 7px; border-radius: var(--radius-sm); }
        #input-right { display: flex; align-items: center; gap: 8px; }
        #char-count { font-size: 11px; color: var(--text-tertiary); }
        #send-btn { width: 34px; height: 34px; border-radius: 50%; border: none; background: var(--send-bg); color: var(--send-color); }
        #send-btn:hover { background: #1f1a16; }
        #send-btn:disabled { background: #ddd3c5; color: #9c907f; cursor: not-allowed; }
        #footer-note { max-width: 760px; margin: 10px auto 0; font-size: 12px; color: var(--text-tertiary); text-align: center; }

        #toast { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: #fcf7ef; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 9px 18px; font-size: 13px; color: var(--text-primary); z-index: 200; opacity: 0; transition: opacity .25s; pointer-events: none; box-shadow: 0 10px 24px rgba(48,37,25,0.12); }
        #toast.show { opacity: 1; }

        .boundary-fallback { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--main-bg); color: var(--text-primary); padding: 24px; }
        .boundary-actions { display: flex; gap: 8px; }
        .boundary-actions button { border: 1px solid var(--border); border-radius: var(--radius-sm); background: #f7f0e5; color: var(--text-primary); padding: 8px 10px; }

        ::view-transition-group(*),
        ::view-transition-old(*),
        ::view-transition-new(*) {
          animation-duration: 0.25s;
          animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1);
        }

        @media (max-width: 640px) {
          #sidebar { position: fixed; top: 0; left: 0; bottom: 0; z-index: 60; transform: translateX(-100%); }
          #sidebar:not(.collapsed) { transform: translateX(0); }
          #welcome h1 { font-size: 30px; text-align: center; }
          .welcome-suggestions { grid-template-columns: 1fr; }
        }
      `}</style>
    </UIErrorBoundary>
  );
}
