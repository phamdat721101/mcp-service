import Demo from '@/components/Demo';

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10 md:py-16">
      <header className="mb-12">
        <p className="text-sm uppercase tracking-widest text-zinc-500">n-payment portal</p>
        <h1 className="mt-2 text-4xl font-semibold leading-tight md:text-5xl">
          Publish a paid MCP in <span className="text-accent">60 seconds</span>.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-zinc-400">
          Bring any HTTPS API. Get a public MCP URL. Claude, Cursor, and Bedrock agents pay you in
          USDC across Base, Flare, and GOAT — and your idle balance auto-yields on Aave.
        </p>
      </header>

      <Demo />

      <footer className="mt-20 border-t border-zinc-900 pt-6 text-sm text-zinc-500">
        <div className="flex flex-wrap items-center gap-3">
          <span>Open portal · MIT license · Built on n-payment SDK v0.19</span>
          <span className="text-zinc-700">·</span>
          <a className="hover:text-zinc-300" href="https://www.npmjs.com/package/n-payment">
            npm
          </a>
          <span className="text-zinc-700">·</span>
          <a className="hover:text-zinc-300" href="/api/healthz">
            health
          </a>
        </div>
      </footer>
    </main>
  );
}
