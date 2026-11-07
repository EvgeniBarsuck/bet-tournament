import { Inject, Injectable } from '@nestjs/common';

import { CONFIG, type Config } from '../config';
import { Database } from '../db/database';
import { type BetEvent, PermanentError } from './bet-event';
import { BetsRepository } from './bets.repository';

export type ApplyResult = 'settled' | 'rolled_back' | 'duplicate' | 'ignored';

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
      return Promise.reject(new PermanentError(`No USD rate configured for ${event.currency}`));
    }
    return this.db.transaction(async (client) => {
      const points = await this.bets.insertSettled(client, event, rate);
      if (points !== null) {
        await this.bets.addPoints(client, event.playerId, points);
        return 'settled';
      }

      // The bet already exists: a redelivery, a late settle after rollback, or a conflict.
      const bet = await this.bets.compareSettlement(client, event);
      if (!bet) throw new Error(`Bet ${event.betId} vanished after insert conflict`);
      if (bet.playerId !== event.playerId) {
        throw new PermanentError(`Bet ${event.betId} belongs to another player`);
      }
      if (bet.status === 'rolled_back') return 'ignored'; // rollback is final
      if (!bet.sameSettlement) {
        throw new PermanentError(`Bet ${event.betId} was settled with other values`);
      }
      return 'duplicate';
    });
  }

  rollback(event: BetEvent): Promise<ApplyResult> {
    return this.db.transaction(async (client) => {
      // Rollback before settle: remember it so the late settle awards nothing.
      if (await this.bets.insertRollbackMarker(client, event.betId, event.playerId)) {
        return 'rolled_back';
      }

      const bet = await this.bets.lock(client, event.betId);
      if (!bet) throw new Error(`Bet ${event.betId} vanished after insert conflict`);
      if (bet.playerId !== event.playerId) {
        throw new PermanentError(`Bet ${event.betId} belongs to another player`);
      }
      if (bet.status === 'rolled_back') return 'duplicate';

      // Subtract exactly what was awarded, regardless of the current rate or event amounts.
      await this.bets.markRolledBack(client, event.betId);
      await this.bets.subtractPoints(client, event.playerId, bet.points);
      return 'rolled_back';
    });
  }
}
