import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchInterface from './search-interface';

describe('SearchInterface', () => {
  it('renders app directly and keeps send disabled until input', () => {
    render(<SearchInterface />);

    expect(screen.getByTestId('app-root')).toBeInTheDocument();
    expect(screen.getByTestId('send-btn')).toBeDisabled();
  });

  it('shows the personalized welcome heading on the empty state', () => {
    render(<SearchInterface />);
    expect(screen.getByTestId('welcome-heading')).toHaveTextContent('Ask me anything!');
  });

  it('enables send after entering a message', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Hello');

    expect(screen.getByTestId('send-btn')).toBeEnabled();
  });

  it('sends /api/chat payload using query and quick mode by default', async () => {
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
      mode: 'quick',
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('forceMode');
  });

  it('renders mode options in the requested order', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-dropdown-btn'));

    const options = screen
      .getAllByTestId(/^search-mode-option-/)
      .map((element) => element.textContent?.trim());

    expect(options).toEqual(['Quick', 'Web Search', 'Thinking', 'Deep Research']);
  });

  it('shows a More Route Info option in the tools dropdown', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-dropdown-btn'));

    expect(screen.getByTestId('more-route-info-btn')).toBeInTheDocument();
  });

  it('sends selected mode in /api/chat payload', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Deep result', citations: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.click(screen.getByTestId('tools-dropdown-btn'));
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

  it('sends uploaded files and git code context in /api/chat payload', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Context-aware response', citations: [] }),
    });
    const promptMock = vi
      .spyOn(window, 'prompt')
      .mockReturnValueOnce('server/index.ts')
      .mockReturnValueOnce('export const handler = () => "ok";');

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    const file = new File(['hello file'], 'notes.txt', { type: 'text/plain' });
    await user.upload(screen.getByTestId('file-input'), file);
    await user.click(screen.getByTestId('tools-dropdown-btn'));
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
    expect(payload.mode).toBe('quick');
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
    expect(payload.files[0].contentKind).toBe('text');
    expect(String(payload.files[0].contentText || '')).toContain('hello file');

    promptMock.mockRestore();
  });

  it('sends binary document uploads as binary content instead of metadata-only', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Parsed PDF', citations: [] }),
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
    expect(typeof payload.files[0].contentBase64).toBe('string');
    expect(String(payload.files[0].contentBase64).length).toBeGreaterThan(0);
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

  it('hides PDF export button before any results appear', () => {
    render(<SearchInterface />);
    expect(screen.queryByTestId('pdf-export-btn')).not.toBeInTheDocument();
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
});
