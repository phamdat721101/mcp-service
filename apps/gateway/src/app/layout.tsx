import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'n-payment Portal — Publish a paid MCP in 60 seconds',
  description:
    'Open portal for API providers and web3 projects to publish paid MCP servers. USDC settlement on Base, Flare, GOAT. Auto-yield via Aave on idle balances.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
