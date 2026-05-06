import { render, screen } from '@testing-library/react';
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
});
