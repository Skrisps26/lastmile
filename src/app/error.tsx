'use client';

import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', background: '#f7f8fc', color: '#172033' }}>
      <h1 style={{ fontSize: '48px', fontWeight: 'bold', margin: '0 0 12px', color: '#ef6b72' }}>500</h1>
      <h2 style={{ fontSize: '20px', margin: '0 0 16px' }}>Something went wrong</h2>
      <p style={{ fontSize: '14px', color: '#72809a', margin: '0 0 24px' }}>{error?.message || 'An unexpected error occurred.'}</p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button onClick={() => reset()} style={{ background: '#f2643b', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}>
          Try Again
        </button>
        <Link href="/" style={{ background: '#e9edf4', color: '#172033', textDecoration: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px' }}>
          Return Home
        </Link>
      </div>
    </div>
  );
}
