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
});
