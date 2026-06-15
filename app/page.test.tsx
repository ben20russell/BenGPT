import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach } from 'vitest';
import SearchInterface from './search-interface';

describe('SearchInterface', () => {
  const originalUserAgent = navigator.userAgent;

  function mockUserAgent(userAgent: string) {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: userAgent,
    });
  }

  function mockMobileViewport(isMobile: boolean) {
    const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 640px)' ? isMobile : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: matchMediaMock,
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    mockUserAgent(originalUserAgent);
    mockMobileViewport(false);
  });

  const popularMobileBrowsers = [
    {
      label: 'iOS Safari',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
      expectedBrowserClass: 'mobile-browser-ios-safari',
    },
    {
      label: 'Android Chrome',
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36',
      expectedBrowserClass: 'mobile-browser-android-chrome',
    },
    {
      label: 'Samsung Internet',
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; SAMSUNG SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/120.0.0.0 Mobile Safari/537.36',
      expectedBrowserClass: 'mobile-browser-samsung-internet',
    },
    {
      label: 'Firefox Android',
      userAgent:
        'Mozilla/5.0 (Android 15; Mobile; rv:138.0) Gecko/138.0 Firefox/138.0',
      expectedBrowserClass: 'mobile-browser-firefox-android',
    },
    {
      label: 'Edge Android',
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36 EdgA/136.0.0.0',
      expectedBrowserClass: 'mobile-browser-edge-android',
    },
  ] as const;

  it.each(popularMobileBrowsers)(
    'applies mobile UX behavior for $label user agent even when media query reports desktop',
    async ({ userAgent, expectedBrowserClass }) => {
      mockUserAgent(userAgent);
      mockMobileViewport(false);
      render(<SearchInterface />);

      await waitFor(() => {
        expect(screen.getByTestId('search-ui-root')).toHaveClass('mobile-device');
      });
      expect(screen.getByTestId('search-ui-root')).toHaveClass(expectedBrowserClass);
      expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
      expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument();
      expect(screen.queryByTestId('mobile-recents-menu')).not.toBeInTheDocument();
    },
  );

  it('keeps the mobile recents hamburger menu closed by default on mobile viewports', async () => {
    mockMobileViewport(true);
    render(<SearchInterface />);

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mobile-recents-menu')).not.toBeInTheDocument();
  });

  it('shows and dismisses the mobile recents hamburger menu via toggle and backdrop', async () => {
    const user = userEvent.setup();
    mockMobileViewport(true);
    render(<SearchInterface />);

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('sidebar-toggle'));
    expect(screen.getByTestId('mobile-recents-menu')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-recents-backdrop')).toHaveClass('show');

    await user.click(screen.getByTestId('mobile-recents-backdrop'));
    expect(screen.queryByTestId('mobile-recents-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-recents-backdrop')).not.toHaveClass('show');
  });

  it('keeps recents visible on desktop without a hamburger toggle', () => {
    mockMobileViewport(false);
    render(<SearchInterface />);

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('conv-list')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument();
  });

  it('renders app directly and keeps send disabled until input', () => {
    render(<SearchInterface />);

    expect(screen.getByTestId('app-root')).toBeInTheDocument();
    expect(screen.getByTestId('send-btn')).toBeDisabled();
  });

  it('shows the personalized welcome heading on the empty state', () => {
    render(<SearchInterface />);
    expect(screen.getByTestId('welcome-heading')).toHaveTextContent('Ask me anything!');
  });

  it('links the Beacon Search AI header brand back to the main page', () => {
    render(<SearchInterface />);
    const homeLink = screen.getByTestId('brand-home-link');
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('uses the same new chat behavior for the header brand link and new chat button', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Behavior check', citations: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Create a conversation');
    await user.click(screen.getByTestId('send-btn'));
    expect(await screen.findByText('Behavior check')).toBeInTheDocument();

    await user.click(screen.getByTestId('brand-home-link'));
    expect(screen.getByTestId('chat-title')).toHaveTextContent('New chat');

    await user.click(screen.getByTestId(/conversation-open-/));
    expect(screen.getByTestId('chat-title')).not.toHaveTextContent('New chat');

    await user.click(screen.getByTestId('new-chat-btn'));
    expect(screen.getByTestId('chat-title')).toHaveTextContent('New chat');
  });

  it('enables send after entering a message', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Hello');

    expect(screen.getByTestId('send-btn')).toBeEnabled();
  });

  it('sends /api/chat payload using query and web search mode by default', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Hybrid response', citations: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Find current trends');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });

    const [url, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    expect(url).toBe('/api/chat');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      query: 'Find current trends',
      mode: 'web_search',
      useMemory: true,
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('forceMode');
  });

  it('allows toggling memory off next to send and sends useMemory false', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Memory disabled response', citations: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    const memoryToggle = screen.getByTestId('memory-toggle-btn');
    expect(memoryToggle).toHaveAttribute('aria-pressed', 'true');
    expect(memoryToggle).toHaveTextContent(/Memory\s+On/i);

    await user.click(memoryToggle);
    expect(memoryToggle).toHaveAttribute('aria-pressed', 'false');
    expect(memoryToggle).toHaveTextContent(/Memory\s+Off/i);

    await user.type(screen.getByTestId('message-input'), 'Answer this without memory');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      query: 'Answer this without memory',
      mode: 'web_search',
      useMemory: false,
    });
  });

  it('renders mode options in the requested order', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-preferences-btn'));

    const options = screen.getAllByTestId(/^search-mode-option-/).map((element) => {
      const title = element.querySelector('.tool-dropdown-item-title');
      return title?.textContent?.trim();
    });

    expect(options).toEqual(['Web Search', 'Thinking', 'Deep Research']);
  });

  it('shows short summaries for each search mode in preferences popup', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-preferences-btn'));

    expect(screen.getByText('Finds current info quickly')).toBeInTheDocument();
    expect(screen.getByText('Solves complex problems')).toBeInTheDocument();
    expect(screen.getByText('Runs deep multi-step research')).toBeInTheDocument();
  });

  it('keeps reasoning options separate from the search mode menu', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-preferences-btn'));
    expect(screen.getAllByTestId(/^search-mode-option-/)).toHaveLength(3);
    expect(screen.queryAllByTestId(/^reasoning-intensity-option-/)).toHaveLength(0);

    await user.click(screen.getByTestId('tools-reasoning-btn'));
    expect(screen.getAllByTestId(/^reasoning-intensity-option-/)).toHaveLength(5);
    expect(screen.queryAllByTestId(/^search-mode-option-/)).toHaveLength(0);
  });

  it('renders reasoning intensity options in the requested order', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-reasoning-btn'));

    const options = screen.getAllByTestId(/^reasoning-intensity-option-/).map((element) => {
      const title = element.querySelector('.tool-dropdown-item-title');
      return title?.textContent?.trim();
    });

    expect(options).toEqual(['Auto', 'Low', 'Medium', 'High', 'Max']);
  });

  it('does not show More Route Info in composer menus', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-add-btn'));
    expect(screen.queryByTestId('more-route-info-btn')).not.toBeInTheDocument();
  });

  it('renders Gemini-style composer controls', () => {
    render(<SearchInterface />);
    expect(screen.getByTestId('tools-add-btn')).toBeInTheDocument();
    expect(screen.getByTestId('tools-preferences-btn')).toBeInTheDocument();
    expect(screen.getByTestId('tools-reasoning-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('tools-dropdown-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pro-mode-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('voice-input-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-btn')).toBeInTheDocument();
  });

  it('sends selected mode in /api/chat payload', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Deep result', citations: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-preferences-btn'));
    await user.click(screen.getByTestId('search-mode-option-deep_research'));
    await user.type(screen.getByTestId('message-input'), 'Research this deeply');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      query: 'Research this deeply',
      mode: 'deep_research',
    });
  });

  it('sends selected reasoning intensity in /api/chat payload', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Reasoning tuned', citations: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-reasoning-btn'));
    await user.click(screen.getByTestId('reasoning-intensity-option-low'));
    await user.type(screen.getByTestId('message-input'), 'Use lower reasoning');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      query: 'Use lower reasoning',
      mode: 'web_search',
      reasoningIntensity: 'low',
    });
  });

  it('sends uploaded files and git code context in /api/chat payload', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/files/upload')) {
        return {
          ok: true,
          json: async () => ({ fileId: 'file_text_uploaded_1' }),
        };
      }

      return {
        ok: true,
        json: async () => ({ answer: 'Context-aware response', citations: [] }),
      };
    });
    const promptMock = vi
      .spyOn(window, 'prompt')
      .mockReturnValueOnce('server/index.ts')
      .mockReturnValueOnce('export const handler = () => "ok";');

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    const file = new File(['hello file'], 'notes.txt', { type: 'text/plain' });
    await user.upload(screen.getByTestId('file-input'), file);
    await user.click(screen.getByTestId('tools-add-btn'));
    await user.click(screen.getByTestId('add-git-code-btn'));
    await user.type(screen.getByTestId('message-input'), 'Use attached context');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    const payload = JSON.parse(String(init.body));

    expect(payload.query).toBe('Use attached context');
    expect(payload.mode).toBe('web_search');
    expect(payload).not.toHaveProperty('forceMode');
    expect(payload.links ?? []).toHaveLength(0);
    expect(payload.gitSnippets).toEqual([
      {
        label: 'server/index.ts',
        code: 'export const handler = () => "ok";',
      },
    ]);
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe('notes.txt');
    expect(payload.files[0].contentKind).toBe('binary');
    expect(payload.files[0].fileId).toBe('file_text_uploaded_1');
    expect(payload.files[0].contentText).toBeUndefined();

    promptMock.mockRestore();
  });

  it('shows per-file upload status before sending a search', async () => {
    const user = userEvent.setup();
    let resolveUpload: ((value: { ok: boolean; json: () => Promise<{ fileId: string }> }) => void) | null = null;
    const uploadResponse = new Promise<{ ok: boolean; json: () => Promise<{ fileId: string }> }>((resolve) => {
      resolveUpload = resolve;
    });

    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/files/upload')) {
        return uploadResponse;
      }

      return {
        ok: true,
        json: async () => ({ answer: 'ok', citations: [] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    const pdfFile = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'status-check.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByTestId('file-input'), pdfFile);

    expect(await screen.findByText(/status-check\.pdf/i)).toBeInTheDocument();
    expect(screen.getByTestId('context-file-status')).toHaveTextContent('Uploading...');

    resolveUpload?.({
      ok: true,
      json: async () => ({ fileId: 'file_status_uploaded_1' }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('context-file-status')).toHaveTextContent('Uploaded');
    });
  });

  it('sends binary document uploads as binary content instead of metadata-only', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/files/upload')) {
        return {
          ok: true,
          json: async () => ({ fileId: 'file_pdf_sample_1' }),
        };
      }

      return {
        ok: true,
        json: async () => ({ answer: 'Parsed PDF', citations: [] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
    const pdfFile = new File([pdfBytes], 'sample.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByTestId('file-input'), pdfFile);
    await user.type(screen.getByTestId('message-input'), 'Analyze this PDF');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe('sample.pdf');
    expect(payload.files[0].contentKind).toBe('binary');
    expect(payload.files[0].fileId).toBe('file_pdf_sample_1');
    expect(payload.files[0].contentBase64).toBeUndefined();
  });

  it('uses uploaded file ids for large PDFs to prevent oversized chat payloads', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/files/upload')) {
        return {
          ok: true,
          json: async () => ({ fileId: 'file_pdf_large_1' }),
        };
      }

      return {
        ok: true,
        json: async () => ({ answer: 'Handled large file', citations: [] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    const hugePdfBytes = new Uint8Array(1024 * 1024);
    const hugePdfFile = new File([hugePdfBytes], 'huge.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByTestId('file-input'), hugePdfFile);
    await user.type(screen.getByTestId('message-input'), 'Use this large attachment');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe('huge.pdf');
    expect(payload.files[0].contentKind).toBe('binary');
    expect(payload.files[0].fileId).toBe('file_pdf_large_1');
    expect(payload.files[0].contentBase64).toBeUndefined();
  });

  it('uploads very large PDFs through chunked upload endpoints to avoid 413 payload errors', async () => {
    const user = userEvent.setup();
    let partCounter = 0;
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/files/upload/chunked/init')) {
        return {
          ok: true,
          json: async () => ({ uploadId: 'upload_pdf_chunked_1' }),
        };
      }

      if (url.includes('/api/files/upload/chunked/part')) {
        partCounter += 1;
        return {
          ok: true,
          json: async () => ({ partId: `part_${partCounter}` }),
        };
      }

      if (url.includes('/api/files/upload/chunked/complete')) {
        return {
          ok: true,
          json: async () => ({ fileId: 'file_pdf_chunked_final_1' }),
        };
      }

      if (url.includes('/api/files/upload')) {
        return {
          ok: true,
          json: async () => ({ fileId: 'file_pdf_direct_should_not_be_used' }),
        };
      }

      return {
        ok: true,
        json: async () => ({ answer: 'Chunked upload worked', citations: [] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    const hugePdfBytes = new Uint8Array(6 * 1024 * 1024 + 512);
    const hugePdfFile = new File([hugePdfBytes], 'chunked-huge.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByTestId('file-input'), hugePdfFile);
    await user.type(screen.getByTestId('message-input'), 'Analyze this very large PDF');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe('chunked-huge.pdf');
    expect(payload.files[0].contentKind).toBe('binary');
    expect(payload.files[0].fileId).toBe('file_pdf_chunked_final_1');
    expect(payload.files[0].contentBase64).toBeUndefined();

    const initCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/files/upload/chunked/init'));
    const partCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/files/upload/chunked/part'));
    const completeCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/api/files/upload/chunked/complete'),
    );
    const directCalls = fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]).includes('/api/files/upload') &&
        !String(call[0]).includes('/api/files/upload/chunked/'),
    );

    expect(initCalls).toHaveLength(1);
    expect(partCalls.length).toBeGreaterThan(1);
    expect(completeCalls).toHaveLength(1);
    expect(directCalls).toHaveLength(0);
  });

  it('falls back to chunked upload when direct PDF upload fails so files still reach /api/chat as file ids', async () => {
    const user = userEvent.setup();
    let partCounter = 0;
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/files/upload/chunked/init')) {
        return {
          ok: true,
          json: async () => ({ uploadId: 'upload_retry_chunked_1' }),
        };
      }

      if (url.includes('/api/files/upload/chunked/part')) {
        partCounter += 1;
        return {
          ok: true,
          json: async () => ({ partId: `retry_part_${partCounter}` }),
        };
      }

      if (url.includes('/api/files/upload/chunked/complete')) {
        return {
          ok: true,
          json: async () => ({ fileId: 'file_retry_chunked_final_1' }),
        };
      }

      if (url.includes('/api/files/upload')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Direct upload endpoint failed unexpectedly.' }),
        };
      }

      return {
        ok: true,
        json: async () => ({ answer: 'Recovered upload path', citations: [] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    const smallPdfBytes = new Uint8Array(512 * 1024);
    const smallPdfFile = new File([smallPdfBytes], 'fallback-small.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByTestId('file-input'), smallPdfFile);
    await user.type(screen.getByTestId('message-input'), 'Use fallback upload');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe('fallback-small.pdf');
    expect(payload.files[0].fileId).toBe('file_retry_chunked_final_1');

    const directCalls = fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]).includes('/api/files/upload') &&
        !String(call[0]).includes('/api/files/upload/chunked/'),
    );
    const initCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/files/upload/chunked/init'));
    const partCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/files/upload/chunked/part'));
    const completeCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/api/files/upload/chunked/complete'),
    );

    expect(directCalls).toHaveLength(1);
    expect(initCalls).toHaveLength(1);
    expect(partCalls.length).toBeGreaterThan(0);
    expect(completeCalls).toHaveLength(1);
  });

  it('does not apply a client-side cap to how many files can be attached in one message', async () => {
    const user = userEvent.setup();
    let uploadCounter = 0;
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/files/upload')) {
        uploadCounter += 1;
        return {
          ok: true,
          json: async () => ({ fileId: `file_many_${uploadCounter}` }),
        };
      }

      return {
        ok: true,
        json: async () => ({ answer: 'All files attached', citations: [] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    const files = Array.from({ length: 25 }, (_, index) => {
      const number = index + 1;
      return new File([`document-${number}`], `doc-${number}.txt`, { type: 'text/plain' });
    });

    await user.upload(screen.getByTestId('file-input'), files);
    await waitFor(() => {
      expect(uploadCounter).toBe(25);
    });

    await user.type(screen.getByTestId('message-input'), 'Analyze all uploaded docs');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chat');
      expect(chatCall).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/chat') as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.files).toHaveLength(25);
    expect(payload.files.every((file: { fileId?: string }) => typeof file.fileId === 'string' && file.fileId.length > 0)).toBe(true);
  });

  it('shows a recovery message when /api/chat returns request-too-large', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => null,
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Trigger request-too-large');
    await user.click(screen.getByTestId('send-btn'));

    expect(await screen.findByText(/exceeded platform size limits/i)).toBeInTheDocument();
    expect(screen.getByText(/start a new chat or reduce non-file context/i)).toBeInTheDocument();
  });

  it('renders trending suggestions from the hourly prompts endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/trending-prompts')) {
        return {
          ok: true,
          json: async () => ({
            suggestions: [
              'What does the latest AI chip news mean for cloud costs?',
              'How could this week’s market headlines affect startup funding?',
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ answer: 'ok', citations: [] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    expect(await screen.findByText('What does the latest AI chip news mean for cloud costs?')).toBeInTheDocument();
    expect(await screen.findByText('How could this week’s market headlines affect startup funding?')).toBeInTheDocument();
  });

  it('renders assistant output in a structured readable layout', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: [
          'Summary:',
          'This answer is organized for readability.',
          '',
          '- Key point one',
          '- Key point two',
          '',
          'Next steps:',
          '1. Do this first',
          '2. Do this second',
        ].join('\n'),
        citations: [],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Format this');
    await user.click(screen.getByTestId('send-btn'));

    expect(await screen.findByText(/Summary:/)).toBeInTheDocument();
    expect(await screen.findByText('Key point one')).toBeInTheDocument();
    expect(await screen.findByText('Do this second')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-rich-output')).toBeInTheDocument();
  });

  it('makes actionable next steps clickable and inserts them into the search input', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: [
          '## Actionable next steps',
          '1. Pull the latest earnings call transcript.',
          '2. Compare this quarter against the prior year trends.',
        ].join('\n'),
        citations: [],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Give me follow-ups');
    await user.click(screen.getByTestId('send-btn'));

    const actionableButton = await screen.findByRole('button', {
      name: 'Compare this quarter against the prior year trends.',
    });
    await user.click(actionableButton);

    expect(screen.getByTestId('message-input')).toHaveValue(
      'Compare this quarter against the prior year trends.',
    );
  });

  it('does not make actionable next steps clickable when they ask for more user info', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: [
          '## Actionable next steps',
          '1. Share your budget and timeline.',
          '2. Provide your preferred destination region.',
        ].join('\n'),
        citations: [],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Plan a trip');
    await user.click(screen.getByTestId('send-btn'));

    expect(await screen.findByText('Share your budget and timeline.')).toBeInTheDocument();
    expect(await screen.findByText('Provide your preferred destination region.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Share your budget and timeline.',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Provide your preferred destination region.',
      }),
    ).not.toBeInTheDocument();
  });

  it('renders markdown headings without showing heading markers', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: [
          '## Results',
          'Top findings from search.',
          '',
          '- Item one',
        ].join('\n'),
        citations: [],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Show heading');
    await user.click(screen.getByTestId('send-btn'));

    expect(await screen.findByText('Results')).toBeInTheDocument();
    expect(screen.queryByText('## Results')).not.toBeInTheDocument();
  });

  it('renders inline markdown formatting and links', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Use **bold** text, `inline code`, and [OpenAI](https://openai.com).',
        citations: [],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Format inline markdown');
    await user.click(screen.getByTestId('send-btn'));

    expect(await screen.findByText('bold')).toBeInTheDocument();
    expect(await screen.findByText('inline code')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'OpenAI' })).toHaveAttribute('href', 'https://openai.com');
  });

  it('renders fenced code blocks with preserved code text', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: ['```ts', 'const answer = 42;', 'console.log(answer);', '```'].join('\n'),
        citations: [],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Show code block');
    await user.click(screen.getByTestId('send-btn'));

    expect(await screen.findByText(/const answer = 42;/)).toBeInTheDocument();
    expect(await screen.findByText(/console\.log\(answer\);/)).toBeInTheDocument();
  });

  it('renders loose ordered list items as a single sequential numbered list', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: [
          'Watch for these next developments:',
          '',
          '1. First checkpoint',
          '',
          'Some supporting context for the first checkpoint.',
          '',
          '1. Second checkpoint',
          '',
          'Some supporting context for the second checkpoint.',
        ].join('\n'),
        citations: [],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Show list numbering');
    await user.click(screen.getByTestId('send-btn'));

    expect(await screen.findByText(/First checkpoint/)).toBeInTheDocument();
    expect(await screen.findByText(/Second checkpoint/)).toBeInTheDocument();
    expect(screen.queryByText('1. First checkpoint')).not.toBeInTheDocument();
    expect(screen.queryByText('1. Second checkpoint')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.ai-list-ol li').length).toBeGreaterThanOrEqual(2);
  });

  it('hides PDF export button before any results appear', () => {
    render(<SearchInterface />);
    expect(screen.queryByTestId('pdf-export-btn')).not.toBeInTheDocument();
  });

  it('compacts the search input and jumps to the top of results after a response is shown', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Result is ready', citations: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    const input = screen.getByTestId('message-input');
    expect(input).toHaveAttribute('rows', '2');
    expect(input).not.toHaveClass('compact');

    await user.type(input, 'Trigger response');
    await user.click(screen.getByTestId('send-btn'));
    expect(await screen.findByText('Result is ready')).toBeInTheDocument();

    const messagesWrap = screen.getByTestId('messages-wrap');
    messagesWrap.scrollTop = 999;
    await user.type(screen.getByTestId('message-input'), 'One more');
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('message-input')).toHaveAttribute('rows', '1');
      expect(screen.getByTestId('message-input')).toHaveClass('compact');
      expect(messagesWrap.scrollTop).toBe(0);
    });
  });

  it('does not show quick action pills near the composer', () => {
    render(<SearchInterface />);
    expect(screen.queryByTestId('quick-action-pills')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write or edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Look something up' })).not.toBeInTheDocument();
  });

  it('renders a bottom anchor for page-end navigation', () => {
    render(<SearchInterface />);
    expect(screen.getByTestId('page-bottom-anchor')).toBeInTheDocument();
  });

  it('exports chat content through a print window when conversation exists', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Exportable answer', citations: [] }),
    });

    const writeMock = vi.fn();
    const closeMock = vi.fn();
    const focusMock = vi.fn();
    const printMock = vi.fn();
    const openMock = vi.fn().mockReturnValue({
      document: {
        write: writeMock,
        close: closeMock,
      },
      focus: focusMock,
      print: printMock,
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', openMock);

    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Create exportable response');
    await user.click(screen.getByTestId('send-btn'));
    expect(await screen.findByText('Exportable answer')).toBeInTheDocument();

    await user.click(screen.getByTestId('pdf-export-btn'));

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith('about:blank', '_blank');
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(focusMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));

    const html = String(writeMock.mock.calls[0]?.[0] ?? '');
    expect(html).toContain('Create exportable response');
    expect(html).toContain('Exportable answer');
  });

  it('renames a recent search by clicking into the title', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Short answer', citations: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'First recent search');
    await user.click(screen.getByTestId('send-btn'));
    expect(await screen.findByText('Short answer')).toBeInTheDocument();

    const titleButton = screen.getByTestId(/conversation-open-/);
    await user.click(titleButton);

    const renameInput = screen.getByTestId(/conversation-edit-/);
    await user.clear(renameInput);
    await user.type(renameInput, 'Renamed search');
    await user.keyboard('{Enter}');

    expect(screen.getByTestId(/conversation-open-/)).toHaveTextContent('Renamed search');
    expect(screen.getByTestId('chat-title')).toHaveTextContent('Renamed search');
  });

  it('deletes and undoes a recent search directly in the saved search row', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/recent-searches') && init?.method === 'GET') {
        return {
          ok: true,
          json: async () => ({ conversations: [], activeConversationId: null }),
        };
      }

      if (url.includes('/api/recent-searches') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      }

      return {
        ok: true,
        json: async () => ({ answer: 'Row actions answer', citations: [] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Delete this row');
    await user.click(screen.getByTestId('send-btn'));
    expect(await screen.findByText('Row actions answer')).toBeInTheDocument();

    const rowButton = screen.getByTestId(/conversation-open-/);
    const conversationId = rowButton.getAttribute('data-testid')?.replace('conversation-open-', '');
    expect(conversationId).toBeTruthy();
    expect(screen.queryByTestId(`conversation-delete-${conversationId}`)).not.toBeInTheDocument();

    await user.click(rowButton);
    expect(screen.getByTestId(`conversation-delete-${conversationId}`)).toBeInTheDocument();

    await user.click(screen.getByTestId(`conversation-delete-${conversationId}`));

    expect(screen.queryByTestId(`conversation-open-${conversationId}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`conversation-deleted-row-${conversationId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`conversation-undo-${conversationId}`)).toBeInTheDocument();

    await user.click(screen.getByTestId(`conversation-undo-${conversationId}`));

    expect(screen.getByTestId(`conversation-open-${conversationId}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`conversation-deleted-row-${conversationId}`)).not.toBeInTheDocument();
  });

  it('click-tests all visible anchors end-to-end', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String((input as { url?: string }).url ?? '')
            : String(input);

      if (url.includes('/api/recent-searches') && init?.method === 'GET') {
        return {
          ok: true,
          json: async () => ({ conversations: [], activeConversationId: null }),
        };
      }

      if (url.includes('/api/recent-searches') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      }

      if (url.includes('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            answer: 'Here are sources.',
            citations: [
              { title: 'OpenAI Docs', url: 'https://platform.openai.com/docs/overview' },
              { title: 'Supabase Docs', url: 'https://supabase.com/docs' },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ suggestions: ['Try this'] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Show links');
    await user.click(screen.getByTestId('send-btn'));
    expect(await screen.findByText('Here are sources.')).toBeInTheDocument();

    const brandLink = screen.getByTestId('brand-home-link');
    expect(brandLink).toHaveAttribute('href', '/');

    const pageBottomAnchor = screen.getByTestId('page-bottom-anchor');
    expect(pageBottomAnchor).toHaveAttribute('href', '#page-bottom-anchor');

    await screen.findByText('OpenAI Docs');
    await screen.findByText('Supabase Docs');
    const citationLinkOne = document.querySelector(
      'a.cite-item[href="https://platform.openai.com/docs/overview"]',
    ) as HTMLAnchorElement | null;
    const citationLinkTwo = document.querySelector(
      'a.cite-item[href="https://supabase.com/docs"]',
    ) as HTMLAnchorElement | null;
    expect(citationLinkOne).not.toBeNull();
    expect(citationLinkTwo).not.toBeNull();
    expect(citationLinkOne).toHaveAttribute('href', 'https://platform.openai.com/docs/overview');
    expect(citationLinkTwo).toHaveAttribute('href', 'https://supabase.com/docs');
    expect(citationLinkOne).toHaveAttribute('target', '_blank');
    expect(citationLinkTwo).toHaveAttribute('target', '_blank');
    await user.click(citationLinkOne);
    await user.click(citationLinkTwo);
    fireEvent.click(pageBottomAnchor);
    await user.click(brandLink);
    expect(screen.getByTestId('chat-title')).toHaveTextContent('New chat');
  });
});
