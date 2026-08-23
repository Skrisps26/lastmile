import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'lastmile. | Logistics, without the guesswork',
  description: 'A modern last-mile logistics operations platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
