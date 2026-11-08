import { Injectable } from '@nestjs/common';

import { LEADERBOARD_SIZE, NO_POINTS } from './leaderboard.constants';
import { LeaderboardRepository } from './leaderboard.repository';
import type { Leaderboard } from './leaderboard.types';

@Injectable()
export class LeaderboardService {
  constructor(private readonly leaderboard: LeaderboardRepository) {}

  /** Top players plus the requested player, who is always present, even without points. */
  async get(playerId: string): Promise<Leaderboard> {
    const row = await this.leaderboard.fetch(playerId, LEADERBOARD_SIZE);

    const player = { playerId, points: row.points ?? NO_POINTS, position: row.position };

    return { top: row.top, player };
  }
}
