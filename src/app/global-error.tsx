'use client';

export const dynamic = 'force-dynamic';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', background: '#f7f8fc', color: '#172033' }}>
        <h1 style={{ fontSize: '48px', fontWeight: 'bold', margin: '0 0 12px', color: '#ef6b72' }}>500</h1>
        <h2 style={{ fontSize: '20px', margin: '0 0 16px' }}>System Error</h2>
        <p style={{ fontSize: '14px', color: '#72809a', margin: '0 0 24px' }}>{error?.message || 'An unexpected system error occurred.'}</p>
        <button onClick={() => reset()} style={{ background: '#f2643b', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}>
          Try Again
        </button>
      </body>
    </html>
  );
}
