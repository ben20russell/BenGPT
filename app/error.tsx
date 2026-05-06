'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.log('[app/error] Route error boundary caught error', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        background: '#212121',
        color: '#ececec',
      }}
      data-testid="route-error-boundary"
    >
      <h2>Something went wrong.</h2>
      <p style={{ color: '#a0a0a0', textAlign: 'center', maxWidth: 520 }}>
        The interface hit an unexpected error. You can retry the action or reload the page to recover.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            background: '#2f2f2f',
            color: '#ececec',
            padding: '8px 12px',
          }}
          data-testid="route-error-retry"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            background: '#2f2f2f',
            color: '#ececec',
            padding: '8px 12px',
          }}
          data-testid="route-error-reload"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}
