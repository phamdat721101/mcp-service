/**
 * `redact` removes secret-shaped fields from any object before logging.
 *
 * Used everywhere we structured-log (gateway, facilitator, cli). Centralized
 * so adding a new sensitive field name is one edit + one regression test.
 */
const SECRET_KEYS: ReadonlyArray<RegExp> = [
  /key$/i,
  /secret$/i,
  /signature$/i,
  /authorization$/i,
  /privatekey$/i,
  /token$/i,
  /password$/i,
  /pkey/i,
  /seed/i,
  /mnemonic/i,
];

const REDACTED = '[redacted]';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function shouldRedact(key: string): boolean {
  return SECRET_KEYS.some((re) => re.test(key));
}

/** Recursively redact secret-shaped fields in-place safe (returns a new object). */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 10) return value;
  if (Array.isArray(value)) return (value.map((v) => redact(v, depth + 1)) as unknown) as T;
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = shouldRedact(k) ? REDACTED : redact(v, depth + 1);
  }
  return out as T;
}
