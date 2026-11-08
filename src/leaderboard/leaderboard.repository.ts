import { Injectable } from '@nestjs/common';

import { Database } from '../db/database';
import type { LeaderboardEntry } from './leaderboard.types';

export interface LeaderboardRow {
  top: LeaderboardEntry[];
  /** null if the player has no points. */
  points: string | null;
  position: number | null;
}

@Injectable()
export class LeaderboardRepository {
  constructor(private readonly db: Database) {}

  /**
   * One statement = one snapshot, so the top and the player's position never
   * contradict each other. Order: points DESC, then playerId ASC (collation C).
   * Players with zero points are not ranked.
   */
  async fetch(playerId: string, limit: number): Promise<LeaderboardRow> {
    const { rows } = await this.db.pool.query<LeaderboardRow>(
      `WITH top AS (
         SELECT player_id, points FROM player_scores
         WHERE points > 0 ORDER BY points DESC, player_id LIMIT $2
       ), me AS (
         SELECT points FROM player_scores WHERE player_id = $1 AND points > 0
       )
       SELECT
         (SELECT coalesce(json_agg(json_build_object(
                    'playerId', player_id, 'points', trim_scale(points)::text, 'position', position)
                  ORDER BY position), '[]')
            FROM (SELECT *, row_number() OVER (ORDER BY points DESC, player_id) AS position FROM top) t
         ) AS top,
         (SELECT trim_scale(points)::text FROM me) AS points,
         (SELECT 1 + (SELECT count(*) FROM player_scores s
                      WHERE s.points > me.points OR (s.points = me.points AND s.player_id < $1))
            FROM me)::int AS position`,
      [playerId, limit],
    );
    const row = rows[0];

    if (!row) throw new Error('Leaderboard query returned no rows');

    return row;
  }
}
