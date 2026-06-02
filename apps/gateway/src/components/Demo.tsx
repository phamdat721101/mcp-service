'use client';

/**
 * Demo client island.
 *
 * One file owns the entire interactive flow. Sub-sections render based on
 * `step`, so adding a step = one entry in `Step` + one renderer below.
 *
 * SOLID:
 *   - Single Responsibility: orchestrate UI state transitions only. Auth +
 *     publish + demo-run hit dedicated API routes; no business logic here.
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { createWalletClient, custom, getAddress, type EIP1193Provider } from 'viem';

type Step = 'connect' | 'siwe' | 'publish' | 'live';

interface Session {
  publisherId: string;
  handle: string;
  address: string;
}

interface PublishedServer {
  serverId: string;
  publicUrl: string;
  slug: string;
}

interface TimelineEvent {
  label: string;
  detail?: string;
  link?: { href: string; text: string };
  ok?: boolean;
}

const CHAINS = [
  { key: 'base-sepolia', label: 'Base Sepolia' },
  { key: 'flare-coston2-testnet', label: 'Flare Coston2' },
  { key: 'goat-testnet3', label: 'GOAT Testnet3' },
] as const;

export default function Demo(): JSX.Element {
  const [step, setStep] = useState<Step>('connect');
  const [address, setAddress] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [server, setServer] = useState<PublishedServer | null>(null);
  const [chain, setChain] = useState<(typeof CHAINS)[number]['key']>('base-sepolia');
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [revenue, setRevenue] = useState({ settled: 0n, fee: 0n, calls: 0 });
  const [yieldPos, setYieldPos] = useState<{ supplied: string; apyBps: number } | null>(null);

  useEffect(() => {
    if (!session) return;
    void refreshRevenue();
    void refreshYield();
    const t = setInterval(() => {
      void refreshRevenue();
      void refreshYield();
    }, 7000);
    return () => clearInterval(t);
  }, [session]);

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
      <section className="rounded-2xl border border-zinc-900 bg-zinc-950 p-6">
        <StepBadge n={1} active={step === 'connect'} done={step !== 'connect'} label="Connect wallet" />
        {step === 'connect' && <ConnectSection onConnected={onConnected} />}
        {step !== 'connect' && address && <Pill>{shorten(address)}</Pill>}

        <StepBadge n={2} active={step === 'siwe'} done={Boolean(session)} label="Sign in" />
        {step === 'siwe' && address && <SiweSection address={address} onSession={onSession} />}
        {session && <Pill>{session.handle}</Pill>}

        <StepBadge n={3} active={step === 'publish'} done={Boolean(server)} label="Publish your MCP" />
        {step === 'publish' && <PublishSection chain={chain} setChain={setChain} onPublished={onPublished} />}
        {server && (
          <div className="mt-2 space-y-2 text-sm">
            <div className="text-zinc-400">Live at</div>
            <code className="block break-all rounded bg-black/40 p-2 text-xs text-emerald-300">
              {origin()}
              {server.publicUrl}
            </code>
            <button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => copy(origin() + server.publicUrl)}>
              Copy URL
            </button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-900 bg-zinc-950 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Live demo</h2>
          <div className="flex items-center gap-2 text-xs">
            <select
              className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-300"
              value={chain}
              onChange={(e) => setChain(e.target.value as typeof chain)}
              disabled={running}
            >
              {CHAINS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              className={clsx(
                'rounded border px-3 py-1 font-medium',
                server && !running
                  ? 'border-accent bg-accent/15 text-accent hover:bg-accent/25'
                  : 'cursor-not-allowed border-zinc-800 text-zinc-600',
              )}
              onClick={runPaidCall}
              disabled={!server || running}
            >
              {running ? 'Running…' : 'Run paid call'}
            </button>
          </div>
        </div>

        <ol className="mt-4 space-y-2 text-sm">
          {timeline.length === 0 && (
            <li className="text-zinc-500">Click "Run paid call" to simulate a Claude Desktop agent paying for your tool.</li>
          )}
          {timeline.map((ev, i) => (
            <li key={i} className="flex gap-2">
              <span className={ev.ok === false ? 'text-rose-400' : 'text-emerald-400'}>▸</span>
              <span>
                {ev.label}
                {ev.detail && <span className="ml-2 text-zinc-500">{ev.detail}</span>}
                {ev.link && (
                  <>
                    {' '}
                    <a className="text-accent underline" href={ev.link.href} target="_blank" rel="noreferrer">
                      {ev.link.text}
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
          <Stat label="Total settled" value={`$${formatUsdc(revenue.settled)}`} sub={`${revenue.calls} calls`} />
          <Stat
            label="Yield (Aave)"
            value={yieldPos ? `+$${formatUsdc(BigInt(yieldPos.supplied))}` : '—'}
            sub={yieldPos ? `${(yieldPos.apyBps / 100).toFixed(2)}% APY` : 'idle balance'}
          />
        </div>
      </section>
    </div>
  );

  // ─── handlers ────────────────────────────────────────────────────────────

  function onConnected(addr: string) {
    setAddress(addr);
    setStep('siwe');
  }
  function onSession(s: Session) {
    setSession(s);
    setStep('publish');
  }
  function onPublished(p: PublishedServer) {
    setServer(p);
    setStep('live');
  }

  async function refreshRevenue() {
    try {
      const r = await fetch('/api/yield', { credentials: 'include' });
      if (!r.ok) return;
      const j = (await r.json()) as { revenue?: { settled?: string; fee?: string; calls?: number } };
      if (j.revenue) {
        setRevenue({
          settled: BigInt(j.revenue.settled ?? '0'),
          fee: BigInt(j.revenue.fee ?? '0'),
          calls: j.revenue.calls ?? 0,
        });
      }
    } catch {
      /* ignore */
    }
  }
  async function refreshYield() {
    try {
      const r = await fetch('/api/yield', { credentials: 'include' });
      if (!r.ok) return;
      const j = (await r.json()) as { yield?: { supplied?: string; apyBps?: number } };
      if (j.yield) setYieldPos({ supplied: j.yield.supplied ?? '0', apyBps: j.yield.apyBps ?? 0 });
    } catch {
      /* ignore */
    }
  }

  async function runPaidCall() {
    if (!server || !session) return;
    setRunning(true);
    setTimeline([{ label: 'tools/call forecast { city: "Tokyo" }' }]);
    try {
      const r = await fetch('/api/demo/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serverId: server.serverId, chain }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        steps?: TimelineEvent[];
        error?: string;
      };
      if (j.steps) setTimeline(j.steps);
      else if (j.error)
        setTimeline((p) => [...p, { label: 'demo failed', detail: j.error ?? 'unknown', ok: false }]);
    } catch (err) {
      setTimeline((p) => [...p, { label: 'demo failed', detail: (err as Error).message, ok: false }]);
    } finally {
      setRunning(false);
      void refreshRevenue();
    }
  }
}

// ─── sub-components ─────────────────────────────────────────────────────────

function ConnectSection({ onConnected }: { onConnected: (a: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  async function connect() {
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<string[]> } }).ethereum;
    if (!eth) return setErr('No injected wallet detected. Install MetaMask or use a wallet browser.');
    try {
      const accs = await eth.request({ method: 'eth_requestAccounts' });
      if (accs[0]) onConnected(accs[0].toLowerCase());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div className="mt-3">
      <button className="rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90" onClick={connect}>
        Connect wallet
      </button>
      {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
    </div>
  );
}

function SiweSection({ address, onSession }: { address: string; onSession: (s: Session) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setErr(null);
    try {
      const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (!eth) throw new Error('No injected wallet detected.');

      // EIP-4361 requires EIP-55 checksummed address; our `address` state is lowercased.
      const checksummed = getAddress(address);

      const message = buildSiweMessage({
        domain: window.location.host,
        address: checksummed,
        uri: window.location.origin,
        chainId: 84532,
        nonce: cryptoNonce(),
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
      });

      // viem handles wallet quirks (Rabby/OKX/Phantom-EVM/MetaMask) + proper error
      // surfacing where raw window.ethereum.request can silently no-op.
      const wallet = createWalletClient({ transport: custom(eth) });
      const signature = await wallet.signMessage({
        account: checksummed,
        message,
      });

      const r = await fetch('/api/auth/siwe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        publisherId?: string;
        handle?: string;
        error?: string;
        message?: string;
      };
      if (!r.ok || !j.publisherId || !j.handle) {
        throw new Error(j.message ? `${j.error ?? 'error'}: ${j.message}` : (j.error ?? 'siwe-failed'));
      }
      onSession({ publisherId: j.publisherId, handle: j.handle, address });
    } catch (e) {
      const code = (e as { code?: number }).code;
      const msg = (e as Error).message ?? 'sign-failed';
      if (code === 4001 || /user rejected|user denied/i.test(msg)) {
        setErr('Signature rejected — try again.');
      } else {
        // eslint-disable-next-line no-console
        console.error('siwe.sign failed', e);
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        className="rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        onClick={signIn}
        disabled={busy}
      >
        {busy ? 'Signing…' : 'Sign to continue'}
      </button>
      {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
    </div>
  );
}

function PublishSection({
  chain,
  setChain,
  onPublished,
}: {
  chain: string;
  setChain: (c: 'base-sepolia' | 'flare-coston2-testnet' | 'goat-testnet3') => void;
  onPublished: (p: PublishedServer) => void;
}) {
  const [slug, setSlug] = useState('weather');
  const [originUrl, setOriginUrl] = useState(
    process.env.NEXT_PUBLIC_DEMO_PUBLISHER_ORIGIN ?? 'https://example-mcp.vercel.app',
  );
  const [tool, setTool] = useState('forecast');
  const [price, setPrice] = useState('10000');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/publish', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          originUrl,
          displayName: slug,
          tool: { name: tool, priceMicros: price, chain },
        }),
      });
      const j = (await r.json()) as { ok?: boolean; serverId?: string; publicUrl?: string; error?: string };
      if (!r.ok || !j.serverId || !j.publicUrl) throw new Error(j.error ?? 'publish-failed');
      onPublished({ serverId: j.serverId, publicUrl: j.publicUrl, slug });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="mt-3 grid grid-cols-2 gap-2 text-sm" onSubmit={submit}>
      <Input label="Slug" value={slug} onChange={setSlug} placeholder="weather" />
      <Input label="Tool name" value={tool} onChange={setTool} placeholder="forecast" />
      <Input className="col-span-2" label="Origin URL" value={originUrl} onChange={setOriginUrl} placeholder="https://…" />
      <Input label="Price (μUSDC)" value={price} onChange={setPrice} placeholder="10000" />
      <div className="flex flex-col">
        <label className="mb-1 text-xs text-zinc-500">Chain</label>
        <select
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-zinc-200"
          value={chain}
          onChange={(e) => setChain(e.target.value as 'base-sepolia')}
        >
          {CHAINS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <button
        className="col-span-2 mt-2 rounded bg-accent px-3 py-2 font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        type="submit"
        disabled={busy}
      >
        {busy ? 'Publishing…' : 'Publish MCP'}
      </button>
      {err && <p className="col-span-2 text-xs text-rose-400">{err}</p>}
    </form>
  );
}

// ─── primitives ─────────────────────────────────────────────────────────────

function StepBadge({ n, active, done, label }: { n: number; active?: boolean; done?: boolean; label: string }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <span
        className={clsx(
          'flex h-6 w-6 items-center justify-center rounded-full text-xs',
          done ? 'bg-emerald-600 text-white' : active ? 'bg-accent text-white' : 'bg-zinc-800 text-zinc-500',
        )}
      >
        {done ? '✓' : n}
      </span>
      <span className={clsx('text-sm font-medium', active ? 'text-zinc-100' : 'text-zinc-400')}>{label}</span>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col', className)}>
      <label className="mb-1 text-xs text-zinc-500">{label}</label>
      <input
        className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-900 bg-black/30 p-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="ml-9 inline-block rounded bg-zinc-900 px-2 py-0.5 text-xs text-zinc-400">{children}</span>;
}

// ─── utils ──────────────────────────────────────────────────────────────────

/**
 * SIWE message builder — server-side `siwe` package parses this exact format.
 * Hand-rolled so we don't ship the `siwe`+`ethers` bundle to the browser.
 */
function buildSiweMessage(o: {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}): string {
  return [
    `${o.domain} wants you to sign in with your Ethereum account:`,
    o.address,
    '',
    'Sign in to n-payment Portal',
    '',
    `URI: ${o.uri}`,
    `Version: 1`,
    `Chain ID: ${o.chainId}`,
    `Nonce: ${o.nonce}`,
    `Issued At: ${o.issuedAt}`,
    `Expiration Time: ${o.expirationTime}`,
  ].join('\n');
}

/** 16-char hex nonce, satisfies SIWE's /^[a-zA-Z0-9]{8,}$/ validator. */
function cryptoNonce(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function shorten(a: string): string {
  return a.slice(0, 6) + '…' + a.slice(-4);
}
function formatUsdc(units: bigint): string {
  // 6-decimal USDC base units → human string with 4 decimals shown
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, '0').slice(0, 4);
  return `${whole}.${frac}`;
}
function origin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}
async function copy(s: string) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    /* ignore */
  }
}
