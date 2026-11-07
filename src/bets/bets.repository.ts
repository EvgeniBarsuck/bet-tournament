import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import type { BetEvent } from './bet-event';

export type BetStatus = 'settled' | 'rolled_back';

/**
 * SQL for bets and player scores. Every method runs on the caller's
 * transaction client; BetsService decides what to call and owns the rules.
 */
@Injectable()
export class BetsRepository {
  /**
   * Inserts a new settled bet with points = winAmount × rate, computed in NUMERIC.
   * Returns the awarded points, or null if the bet already exists.
   */
  async insertSettled(client: PoolClient, event: BetEvent, rate: string): Promise<string | null> {
    const { rows } = await client.query<{ points: string }>(
      `INSERT INTO bets (bet_id, player_id, status, currency, stake, win_amount, settled_at, usd_rate, points)
       VALUES ($1, $2, 'settled', $3, $4, $5, $6, $7, $5::numeric * $7::numeric)
       ON CONFLICT (bet_id) DO NOTHING
       RETURNING points::text`,
      [
        event.betId,
        event.playerId,
        event.currency,
        event.stake,
        event.winAmount,
        event.settledAt,
        rate,
      ],
    );
    return rows[0]?.points ?? null;
  }

  /** Remembers a rollback that arrived first. Returns false if the bet already exists. */
  async insertRollbackMarker(
    client: PoolClient,
    betId: string,
    playerId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO bets (bet_id, player_id, status) VALUES ($1, $2, 'rolled_back')
       ON CONFLICT (bet_id) DO NOTHING`,
      [betId, playerId],
    );
    return result.rowCount === 1;
  }

  /**
   * Reads an existing bet and whether its saved settlement equals the event.
   * Values are compared in SQL as numbers and instants, so "10.0" equals "10.00".
   */
  async compareSettlement(
    client: PoolClient,
    event: BetEvent,
  ): Promise<{ playerId: string; status: BetStatus; sameSettlement: boolean } | undefined> {
    const { rows } = await client.query<{ player_id: string; status: BetStatus; same: boolean }>(
      `SELECT player_id, status,
         coalesce(currency = $2 AND stake = $3::numeric AND win_amount = $4::numeric
                  AND settled_at = $5::timestamptz, false) AS same
       FROM bets WHERE bet_id = $1`,
      [event.betId, event.currency, event.stake, event.winAmount, event.settledAt],
    );
    const row = rows[0];
    return row && { playerId: row.player_id, status: row.status, sameSettlement: row.same };
  }

  /** Locks the bet row until the end of the transaction. */
  async lock(
    client: PoolClient,
    betId: string,
  ): Promise<{ playerId: string; status: BetStatus; points: string } | undefined> {
    const { rows } = await client.query<{ player_id: string; status: BetStatus; points: string }>(
      'SELECT player_id, status, points::text FROM bets WHERE bet_id = $1 FOR UPDATE',
      [betId],
    );
    const row = rows[0];
    return row && { playerId: row.player_id, status: row.status, points: row.points };
  }

  async markRolledBack(client: PoolClient, betId: string): Promise<void> {
    await client.query(
      "UPDATE bets SET status = 'rolled_back', updated_at = now() WHERE bet_id = $1",
      [betId],
    );
  }

  /** Atomic delta: concurrent awards for one player never overwrite each other. */
  async addPoints(client: PoolClient, playerId: string, points: string): Promise<void> {
    await client.query(
      `INSERT INTO player_scores (player_id, points) VALUES ($1, $2)
       ON CONFLICT (player_id) DO UPDATE
       SET points = player_scores.points + EXCLUDED.points, updated_at = now()`,
      [playerId, points],
    );
  }

  /** The CHECK (points >= 0) constraint rejects a subtraction below zero. */
  async subtractPoints(client: PoolClient, playerId: string, points: string): Promise<void> {
    await client.query(
      'UPDATE player_scores SET points = points - $2, updated_at = now() WHERE player_id = $1',
      [playerId, points],
    );
  }
}
