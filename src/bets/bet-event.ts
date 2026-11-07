import { z } from 'zod';

export const BET_SETTLED = 'bet.settled';
export const BET_ROLLBACK = 'bet.rollback';

/** Shared by event IDs and the X-Player-Id header. */
export const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

// Money arrives as a decimal string: JSON numbers lose precision.
const amount = z.string().regex(/^\d{1,12}(\.\d{1,8})?$/, 'decimal string, max 12.8 digits');

export const betEventSchema = z.object({
  betId: z.string().regex(ID_PATTERN),
  playerId: z.string().regex(ID_PATTERN),
  currency: z.string().regex(/^[A-Z]{3}$/),
  stake: amount,
  winAmount: amount,
  settledAt: z.iso.datetime({ offset: true }),
});

export type BetEvent = z.infer<typeof betEventSchema>;

/** Business rule violation: retrying the same message cannot fix it. */
export class PermanentError extends Error {
  override readonly name = 'PermanentError';
}
