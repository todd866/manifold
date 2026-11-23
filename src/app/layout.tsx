import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Manifold — Latent Pool & Signed Lenses',
  description:
    'Shared embedding coordinates, Ed25519-signed curation lenses, canary reputation, and MCP server across Onto the TV, Onto the Radio, and Cohort.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
