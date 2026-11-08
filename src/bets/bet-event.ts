import { z } from 'zod';

import { CURRENCY_PATTERN, DECIMAL_PATTERN, ID_PATTERN } from '../common/formats';
import { YEAR_ZERO } from './bets.constants';

// Money arrives as a decimal string: JSON numbers lose precision.
const amount = z.string().regex(DECIMAL_PATTERN, 'decimal string, max 12.8 digits');

export const betEventSchema = z.object({
  betId: z.string().regex(ID_PATTERN),
  playerId: z.string().regex(ID_PATTERN),
  currency: z.string().regex(CURRENCY_PATTERN),
  stake: amount,
  winAmount: amount,
  settledAt: z.iso
    .datetime({ offset: true })
    .refine((value) => !YEAR_ZERO.test(value), 'year 0000 does not exist'),
});

export type BetEvent = z.infer<typeof betEventSchema>;
