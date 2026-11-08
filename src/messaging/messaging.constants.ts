export const DEFAULT_QUEUE = 'bet.events';

/** Rejected messages go `<queue>` → `<queue>.dlx` exchange → `<queue>.dlq` queue. */
export const DEAD_LETTER_EXCHANGE_SUFFIX = '.dlx';
export const DEAD_LETTER_QUEUE_SUFFIX = '.dlq';
export const DEAD_LETTER_ROUTING_KEY = 'failed';

/**
 * Failed deliveries (crash, killed process, closed channel) before the broker
 * dead-letters a message. Requeue by republishing does not count.
 */
export const DELIVERY_LIMIT = 20;

/** Headers the consumer adds to a dead-lettered or republished copy. */
export const MESSAGE_HEADER = Object.freeze({
  REJECTION_CODE: 'x-rejection-code',
  REJECTION_REASON: 'x-rejection-reason',
  REJECTED_AT: 'x-rejected-at',
  REQUEUE_COUNT: 'x-requeue-count',
});

/** Set by the broker; a copy must start counting from zero. */
export const BROKER_HEADERS: readonly string[] = Object.freeze(['x-delivery-count', 'x-death']);

/** Keeps headers far below the AMQP frame size. */
export const MAX_REASON_LENGTH = 1_000;

/**
 * Fixed tag of the app's consumer on its channel, so shutdown can cancel it with
 * basic.cancel. Tags are unique per channel, and each process has its own channel.
 */
export const CONSUMER_TAG = 'bet-tournament';

export const MESSAGE_CONTENT_TYPE = 'application/json';
export const AMQP_CONNECT_TIMEOUT_MS = 5_000;

/** Nest RMQ server status values that mean the consumer has a live connection. */
export const BROKER_CONNECTED = 'connected';
export const BROKER_DISCONNECTED = 'disconnected';
