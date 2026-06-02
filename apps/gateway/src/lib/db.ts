/**
 * lib/db.ts — direct Postgres client.
 *
 * Connects to the Supabase pgbouncer transaction pool (or any plain Postgres).
 * One env var: `DATABASE_URL`.
 *
 * SOLID:
 *   - Single Responsibility: build the client lazily on first call, cache it.
 *   - Dependency Inversion: routes import { db } and never see the driver.
 *
 * pgbouncer note: transaction-mode poolers do NOT support prepared statements,
 * so `prepare: false` is mandatory. The default port 6543 in DATABASE_URL is
 * the transaction pool; port 5432 is the direct connection (also fine).
 */
import postgres, { type Sql } from 'postgres';

let cached: Sql | undefined;

export function db(): Sql {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  cached = postgres(url, {
    ssl: 'require',
    prepare: false, // required for pgbouncer transaction-mode pool
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { application_name: 'n-payment-gateway' },
  });
  return cached;
}
