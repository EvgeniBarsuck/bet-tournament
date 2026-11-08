import type { BetRejectionCode } from './bets.constants';

/**
 * Expected business rejection: the event contradicts the rules or saved data,
 * so retrying it cannot help. Goes to the DLQ and is logged as a warning.
 *
 * Other error kinds are deliberately not wrapped:
 * - transient pg errors keep their SQLSTATE so `isTransientDbError` can retry them;
 * - impossible states are plain `Error`: a bug, logged with its stack.
 */
export class BetRejectedError extends Error {
  override readonly name = BetRejectedError.name;

  constructor(
    readonly code: BetRejectionCode,
    message: string,
  ) {
    super(message);
  }
}
