import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchInterface from './search-interface';

describe('SearchInterface', () => {
  it('shows key modal on load and keeps send disabled', () => {
    render(<SearchInterface />);

    expect(screen.getByTestId('key-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('send-btn')).toBeDisabled();
  });

  it('enables app after valid key submit', async () => {
    const user = userEvent.setup();
    render(<SearchInterface />);

    await user.type(screen.getByTestId('key-input'), 'sk-test-123456');
    await user.click(screen.getByTestId('key-submit'));

    expect(screen.queryByTestId('key-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('app-root')).toBeInTheDocument();
  });
});
