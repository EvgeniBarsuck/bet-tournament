/** Nest envelope `pattern` values. */
export const BET_PATTERN = Object.freeze({
  SETTLED: 'bet.settled',
  ROLLBACK: 'bet.rollback',
} as const);

export type BetPattern = (typeof BET_PATTERN)[keyof typeof BET_PATTERN];

/** bets.status column values. */
export const BET_STATUS = Object.freeze({
  SETTLED: 'settled',
  ROLLED_BACK: 'rolled_back',
} as const);

export type BetStatus = (typeof BET_STATUS)[keyof typeof BET_STATUS];

/** Outcome of applying one event; logged by the consumer. */
export const APPLY_RESULT = Object.freeze({
  SETTLED: 'settled',
  ROLLED_BACK: 'rolled_back',
  DUPLICATE: 'duplicate',
  IGNORED: 'ignored',
} as const);

export type ApplyResult = (typeof APPLY_RESULT)[keyof typeof APPLY_RESULT];

/** Consumer log outcomes besides ApplyResult. */
export const CONSUMER_OUTCOME = Object.freeze({
  REJECTED: 'rejected',
  RETRY: 'retry',
  /** Transient DB error outlived the retries: republished to the queue, never to the DLQ. */
  REQUEUED: 'requeued',
  /** Shutdown started before the message was processed: republished to the queue. */
  INTERRUPTED: 'interrupted',
} as const);

/** Why a message was requeued; sent as the rejection reason header of the copy. */
export const REQUEUE_REASON = Object.freeze({
  TRANSIENT_DB_ERROR: 'TRANSIENT_DB_ERROR',
  SHUTDOWN: 'SHUTDOWN',
} as const);

/** How long shutdown waits for in-flight messages before the channel is closed. */
export const DRAIN_TIMEOUT_MS = 10_000;

/**
 * Delays before re-running a transaction that failed with a transient DB error.
 * About a minute in total, then the message is republished to the queue and the cycle
 * starts over, so a database outage pauses processing instead of draining the queue
 * to the DLQ. Republishing, unlike nack with requeue, does not count against the
 * quorum queue delivery limit. Must stay well below RabbitMQ consumer_timeout (30 min).
 */
export const RETRY_DELAYS_MS: readonly number[] = Object.freeze([
  200, 1_000, 5_000, 15_000, 30_000,
]);

export const RETRY_DELAYS = Symbol('RETRY_DELAYS');

/** PostgreSQL timestamptz has no year 0, while ISO 8601 allows "0000-...". */
export const YEAR_ZERO = /^0000-/;

/**
 * Why an event was rejected for business reasons. Logged and sent in the
 * x-rejection-code header of the message copy in the DLQ.
 */
export const BET_REJECTION = Object.freeze({
  INVALID_EVENT: 'INVALID_EVENT',
  UNKNOWN_CURRENCY: 'UNKNOWN_CURRENCY',
  OWNER_CONFLICT: 'OWNER_CONFLICT',
  SETTLEMENT_CONFLICT: 'SETTLEMENT_CONFLICT',
} as const);

export type BetRejectionCode = (typeof BET_REJECTION)[keyof typeof BET_REJECTION];

/** x-rejection-code of a message dead-lettered because of a bug, not a business rule. */
export const UNEXPECTED_ERROR = 'UNEXPECTED_ERROR';
