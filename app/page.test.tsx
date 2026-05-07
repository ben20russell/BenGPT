import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchInterface from './search-interface';

describe('SearchInterface', () => {
  it('renders app directly and keeps send disabled until input', () => {
    render(<SearchInterface />);

    expect(screen.getByTestId('app-root')).toBeInTheDocument();
    expect(screen.getByTestId('send-btn')).toBeDisabled();
  });

  it('enables send after entering a message', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Hello');

    expect(screen.getByTestId('send-btn')).toBeEnabled();
  });

  it('sends /api/chat payload using query and forceMode', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Hybrid response', citations: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchInterface />);

    await user.type(screen.getByTestId('message-input'), 'Find current trends');
    await user.click(screen.getByTestId('mode-web'));
    await user.click(screen.getByTestId('send-btn'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      query: 'Find current trends',
      forceMode: 'web',
    });
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

    expect(await screen.findByText('Summary')).toBeInTheDocument();
    expect(await screen.findByText('Key point one')).toBeInTheDocument();
    expect(await screen.findByText('Do this second')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-rich-output')).toBeInTheDocument();
  });

  it('shows a PDF export button', () => {
    render(<SearchInterface />);
    expect(screen.getByTestId('pdf-export-btn')).toBeInTheDocument();
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
});
