/**
 * Error taxonomy for the Gateway, Facilitator, and CLI.
 *
 * Every error has a stable `code` string. HTTP status, JSON-RPC code, and
 * client-facing message are derived deterministically from the code — never
 * branched by message text.
 *
 * Design (Single Source of Truth):
 *   - One base class `GatewayError` carries `code`, `httpStatus`, `jsonRpcCode`.
 *   - Subclasses set defaults; callers may override `cause` and `details`.
 *   - Add a new error = one new subclass + one entry in `ERROR_REGISTRY`.
 */

export type ErrorCode =
  // payment / x402
  | 'payment.declined'
  | 'payment.facilitator.unreachable'
  | 'payment.amount.exceeds-cap'
  | 'payment.balance.insufficient'
  | 'payment.signature.failed'
  | 'payment.signature.expired'
  | 'payment.signature.replay'
  | 'payment.network.error'
  | 'payment.policy.denied'
  | 'payment.challenge.unparseable'
  | 'payment.settle.failed'
  | 'payment.settle.reverted'
  // gateway routing
  | 'gateway.publisher.not-found'
  | 'gateway.server.not-found'
  | 'gateway.tool.not-found'
  | 'gateway.origin.unreachable'
  | 'gateway.origin.invalid-response'
  // auth
  | 'auth.token.invalid'
  | 'auth.token.expired'
  | 'auth.privy.unreachable'
  | 'auth.unauthorized'
  | 'auth.forbidden'
  // billing
  | 'billing.tier.exceeded'
  | 'billing.stripe.unreachable'
  | 'billing.invoice.failed'
  // rate limiting
  | 'rate-limit.exceeded'
  // treasury
  | 'treasury.sponsor.not-provisioned'
  | 'treasury.sponsor.balance-low'
  | 'treasury.vault.decryption-failed'
  // generic
  | 'internal.error';

interface ErrorMeta {
  httpStatus: number;
  /** JSON-RPC error code per MCP. -32402 is our custom Payment-Required. */
  jsonRpcCode: number;
  /** Public-facing default message; specific instances may override. */
  defaultMessage: string;
}

/** SOLID — single map registry. New code = new entry; nothing else changes. */
export const ERROR_REGISTRY: Readonly<Record<ErrorCode, ErrorMeta>> = Object.freeze({
  'payment.declined': { httpStatus: 402, jsonRpcCode: -32402, defaultMessage: 'Payment declined' },
  'payment.facilitator.unreachable': {
    httpStatus: 502,
    jsonRpcCode: -32603,
    defaultMessage: 'Facilitator unreachable',
  },
  'payment.amount.exceeds-cap': {
    httpStatus: 402,
    jsonRpcCode: -32402,
    defaultMessage: 'Payment amount exceeds policy cap',
  },
  'payment.balance.insufficient': {
    httpStatus: 402,
    jsonRpcCode: -32402,
    defaultMessage: 'Buyer balance insufficient',
  },
  'payment.signature.failed': {
    httpStatus: 400,
    jsonRpcCode: -32602,
    defaultMessage: 'Payment signature invalid',
  },
  'payment.signature.expired': {
    httpStatus: 400,
    jsonRpcCode: -32602,
    defaultMessage: 'Payment signature expired',
  },
  'payment.signature.replay': {
    httpStatus: 409,
    jsonRpcCode: -32602,
    defaultMessage: 'Payment authorization already used',
  },
  'payment.network.error': {
    httpStatus: 502,
    jsonRpcCode: -32603,
    defaultMessage: 'Network error during payment',
  },
  'payment.policy.denied': {
    httpStatus: 403,
    jsonRpcCode: -32402,
    defaultMessage: 'Payment denied by policy',
  },
  'payment.challenge.unparseable': {
    httpStatus: 502,
    jsonRpcCode: -32603,
    defaultMessage: 'Payment challenge could not be parsed',
  },
  'payment.settle.failed': {
    httpStatus: 502,
    jsonRpcCode: -32603,
    defaultMessage: 'Settlement failed',
  },
  'payment.settle.reverted': {
    httpStatus: 502,
    jsonRpcCode: -32603,
    defaultMessage: 'Settlement reverted on-chain',
  },
  'gateway.publisher.not-found': {
    httpStatus: 404,
    jsonRpcCode: -32601,
    defaultMessage: 'Publisher not found',
  },
  'gateway.server.not-found': {
    httpStatus: 404,
    jsonRpcCode: -32601,
    defaultMessage: 'MCP server not found',
  },
  'gateway.tool.not-found': {
    httpStatus: 404,
    jsonRpcCode: -32601,
    defaultMessage: 'Tool not found on this MCP server',
  },
  'gateway.origin.unreachable': {
    httpStatus: 502,
    jsonRpcCode: -32603,
    defaultMessage: 'Publisher origin unreachable',
  },
  'gateway.origin.invalid-response': {
    httpStatus: 502,
    jsonRpcCode: -32603,
    defaultMessage: 'Publisher origin returned an invalid response',
  },
  'auth.token.invalid': {
    httpStatus: 401,
    jsonRpcCode: -32600,
    defaultMessage: 'Authentication token invalid',
  },
  'auth.token.expired': {
    httpStatus: 401,
    jsonRpcCode: -32600,
    defaultMessage: 'Authentication token expired',
  },
  'auth.privy.unreachable': {
    httpStatus: 502,
    jsonRpcCode: -32603,
    defaultMessage: 'Auth provider unreachable',
  },
  'auth.unauthorized': { httpStatus: 401, jsonRpcCode: -32600, defaultMessage: 'Unauthorized' },
  'auth.forbidden': { httpStatus: 403, jsonRpcCode: -32600, defaultMessage: 'Forbidden' },
  'billing.tier.exceeded': {
    httpStatus: 429,
    jsonRpcCode: -32429,
    defaultMessage: 'Tier allowance exceeded',
  },
  'billing.stripe.unreachable': {
    httpStatus: 502,
    jsonRpcCode: -32603,
    defaultMessage: 'Billing provider unreachable',
  },
  'billing.invoice.failed': {
    httpStatus: 500,
    jsonRpcCode: -32603,
    defaultMessage: 'Invoice generation failed',
  },
  'rate-limit.exceeded': {
    httpStatus: 429,
    jsonRpcCode: -32429,
    defaultMessage: 'Rate limit exceeded',
  },
  'treasury.sponsor.not-provisioned': {
    httpStatus: 503,
    jsonRpcCode: -32603,
    defaultMessage: 'Sponsor wallet not provisioned',
  },
  'treasury.sponsor.balance-low': {
    httpStatus: 503,
    jsonRpcCode: -32603,
    defaultMessage: 'Sponsor wallet balance too low',
  },
  'treasury.vault.decryption-failed': {
    httpStatus: 500,
    jsonRpcCode: -32603,
    defaultMessage: 'Vault decryption failed',
  },
  'internal.error': {
    httpStatus: 500,
    jsonRpcCode: -32603,
    defaultMessage: 'Internal error',
  },
});

export interface GatewayErrorOptions {
  message?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

/**
 * Base error class. Subclasses fix `code` so call sites stay terse:
 *
 *     throw new PaymentDeclinedError({ details: { reason: 'auth-expired' } });
 */
export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly jsonRpcCode: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, opts: GatewayErrorOptions = {}) {
    const meta = ERROR_REGISTRY[code];
    super(opts.message ?? meta.defaultMessage, opts.cause !== undefined ? { cause: opts.cause } : {});
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = meta.httpStatus;
    this.jsonRpcCode = meta.jsonRpcCode;
    this.details = opts.details;
  }

  /** Wire shape for HTTP responses. */
  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }

  /** Wire shape for JSON-RPC error.data. */
  toJsonRpcError() {
    return {
      code: this.jsonRpcCode,
      message: this.message,
      data: { code: this.code, ...(this.details ?? {}) },
    };
  }
}

// Concrete subclasses — terse call sites + exhaustive-typing in catch blocks.
export class PaymentDeclinedError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.declined', opts);
  }
}
export class FacilitatorUnreachableError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.facilitator.unreachable', opts);
  }
}
export class AmountExceedsCapError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.amount.exceeds-cap', opts);
  }
}
export class BalanceInsufficientError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.balance.insufficient', opts);
  }
}
export class SignatureFailedError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.signature.failed', opts);
  }
}
export class SignatureExpiredError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.signature.expired', opts);
  }
}
export class SignatureReplayError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.signature.replay', opts);
  }
}
export class PolicyDeniedError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.policy.denied', opts);
  }
}
export class UnparseableChallengeError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.challenge.unparseable', opts);
  }
}
export class SettleFailedError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.settle.failed', opts);
  }
}
export class SettleRevertedError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('payment.settle.reverted', opts);
  }
}
export class PublisherNotFoundError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('gateway.publisher.not-found', opts);
  }
}
export class ServerNotFoundError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('gateway.server.not-found', opts);
  }
}
export class OriginUnreachableError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('gateway.origin.unreachable', opts);
  }
}
export class TokenInvalidError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('auth.token.invalid', opts);
  }
}
export class TokenExpiredError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('auth.token.expired', opts);
  }
}
export class UnauthorizedError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('auth.unauthorized', opts);
  }
}
export class ForbiddenError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('auth.forbidden', opts);
  }
}
export class TierExceededError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('billing.tier.exceeded', opts);
  }
}
export class RateLimitExceededError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('rate-limit.exceeded', opts);
  }
}
export class SponsorNotProvisionedError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('treasury.sponsor.not-provisioned', opts);
  }
}
export class SponsorBalanceLowError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('treasury.sponsor.balance-low', opts);
  }
}
export class VaultDecryptionFailedError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('treasury.vault.decryption-failed', opts);
  }
}
export class InternalError extends GatewayError {
  constructor(opts: GatewayErrorOptions = {}) {
    super('internal.error', opts);
  }
}

/** Type guard for catch blocks that can't `instanceof` (cross-realm). */
export function isGatewayError(e: unknown): e is GatewayError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    'httpStatus' in e &&
    typeof (e as GatewayError).code === 'string' &&
    (e as GatewayError).code in ERROR_REGISTRY
  );
}

/** Convert any thrown value into a GatewayError. */
export function asGatewayError(e: unknown): GatewayError {
  if (isGatewayError(e)) return e;
  if (e instanceof Error) return new InternalError({ message: e.message, cause: e });
  return new InternalError({ message: String(e) });
}
