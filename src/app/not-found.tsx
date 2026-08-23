import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', background: '#f7f8fc', color: '#172033' }}>
      <h1 style={{ fontSize: '48px', fontWeight: 'bold', margin: '0 0 12px', color: '#f2643b' }}>404</h1>
      <h2 style={{ fontSize: '20px', margin: '0 0 16px' }}>Page Not Found</h2>
      <p style={{ fontSize: '14px', color: '#72809a', margin: '0 0 24px' }}>The requested resource could not be found.</p>
      <Link href="/" style={{ background: '#f2643b', color: '#fff', textDecoration: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px' }}>
        Return to Home
      </Link>
    </div>
  );
}
