import { Inject, Injectable } from '@nestjs/common';

import { CONFIG, type Config } from '../config/config';
import { Database } from '../db/database';
import type { BetEvent } from './bet-event';
import { APPLY_RESULT, type ApplyResult, BET_REJECTION, BET_STATUS } from './bets.constants';
import { BetRejectedError } from './bets.errors';
import { BetsRepository } from './bets.repository';

/**
 * Tournament rules. Every operation is one transaction: the bet row and the
 * player's score change together or not at all. The unique bet_id makes
 * redelivered messages harmless.
 */
@Injectable()
export class BetsService {
  constructor(
    private readonly db: Database,
    private readonly bets: BetsRepository,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  settle(event: BetEvent): Promise<ApplyResult> {
    const rate = this.config.rates.get(event.currency);

    if (rate === undefined) {
      return Promise.reject(
        new BetRejectedError(
          BET_REJECTION.UNKNOWN_CURRENCY,
          `No USD rate configured for ${event.currency}`,
        ),
      );
    }

    return this.db.transaction(async (client) => {
      const points = await this.bets.insertSettled(client, event, rate);

      if (points !== null) {
        await this.bets.addPoints(client, event.playerId, points);

        return APPLY_RESULT.SETTLED;
      }

      // The bet already exists: a redelivery, a late settle after rollback, or a conflict.
      const bet = await this.bets.compareSettlement(client, event);

      if (!bet) throw new Error(`Bet ${event.betId} vanished after insert conflict`);

      if (bet.playerId !== event.playerId) {
        throw new BetRejectedError(
          BET_REJECTION.OWNER_CONFLICT,
          `Bet ${event.betId} belongs to another player`,
        );
      }

      if (bet.status === BET_STATUS.ROLLED_BACK) return APPLY_RESULT.IGNORED; // rollback is final

      if (!bet.sameSettlement) {
        throw new BetRejectedError(
          BET_REJECTION.SETTLEMENT_CONFLICT,
          `Bet ${event.betId} was settled with other values`,
        );
      }

      return APPLY_RESULT.DUPLICATE;
    });
  }

  rollback(event: BetEvent): Promise<ApplyResult> {
    return this.db.transaction(async (client) => {
      // Rollback before settle: remember it so the late settle awards nothing.
      if (await this.bets.insertRollbackMarker(client, event.betId, event.playerId)) {
        return APPLY_RESULT.ROLLED_BACK;
      }

      const bet = await this.bets.lock(client, event.betId);

      if (!bet) throw new Error(`Bet ${event.betId} vanished after insert conflict`);

      if (bet.playerId !== event.playerId) {
        throw new BetRejectedError(
          BET_REJECTION.OWNER_CONFLICT,
          `Bet ${event.betId} belongs to another player`,
        );
      }

      if (bet.status === BET_STATUS.ROLLED_BACK) return APPLY_RESULT.DUPLICATE;

      // Subtract exactly what was awarded, regardless of the current rate or event amounts.
      await this.bets.markRolledBack(client, event.betId);

      // Every settle creates the score row, so a missing one means corrupted data.
      if (!(await this.bets.subtractPoints(client, event.playerId, bet.points))) {
        throw new Error(`Score of ${event.playerId} is missing for settled bet ${event.betId}`);
      }

      return APPLY_RESULT.ROLLED_BACK;
    });
  }
}
