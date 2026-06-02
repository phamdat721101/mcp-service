/**
 * Structured JSON logger.
 *
 * Pure shape: `{ level, msg, ts, ...ctx }`. No transport — logs go to stdout
 * for Vercel/Fly to ship into their pipelines. Sensitive fields are redacted
 * via the shared helper.
 */
import { redact } from '@n-payment/shared';

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  const safe = ctx ? (redact(ctx) as Record<string, unknown>) : undefined;
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(safe ?? {}) });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
};
