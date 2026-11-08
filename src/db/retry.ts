import { setTimeout as sleep } from 'node:timers/promises';

import {
  CONNECTION_EXCEPTION_CLASS,
  CONNECTION_LOST_MESSAGE,
  TRANSIENT_DB_CODES,
} from './database.constants';

export function isTransientDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const code = (error as { code?: unknown }).code;

  if (typeof code === 'string')
    return TRANSIENT_DB_CODES.has(code) || code.startsWith(CONNECTION_EXCEPTION_CLASS);

  return CONNECTION_LOST_MESSAGE.test(error.message);
}

/**
 * Re-runs the whole operation (a complete transaction) after transient DB errors,
 * waiting outside the transaction. Any other error, or the last failure, is thrown.
 * An aborted signal stops the waiting: the sleep rejects with an AbortError.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  delaysMs: readonly number[],
  onRetry: (attempt: number, error: unknown) => void = () => undefined,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const delay = delaysMs[attempt];

      if (delay === undefined || !isTransientDbError(error)) throw error;

      onRetry(attempt + 1, error);
      await sleep(delay, undefined, { signal });
    }
  }
}
