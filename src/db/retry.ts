import { setTimeout as sleep } from 'node:timers/promises';

// Errors that may succeed when the whole transaction is retried.
const TRANSIENT_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available (lock_timeout)
  '57014', // query_canceled (statement_timeout)
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
]);

export function isTransientDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return TRANSIENT_CODES.has(code) || code.startsWith('08');
  // pg reports a dropped connection / pool checkout timeout without a code.
  return /^Connection terminated|timeout exceeded when trying to connect/.test(error.message);
}

/**
 * Re-runs the whole operation (a complete transaction) after transient DB errors,
 * waiting outside the transaction. Any other error, or the last failure, is thrown.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  delaysMs: readonly number[],
  onRetry: (attempt: number, error: unknown) => void = () => undefined,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const delay = delaysMs[attempt];
      if (delay === undefined || !isTransientDbError(error)) throw error;
      onRetry(attempt + 1, error);
      await sleep(delay);
    }
  }
}
