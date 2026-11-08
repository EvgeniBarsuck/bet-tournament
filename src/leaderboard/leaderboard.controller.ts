import { Controller, Get } from '@nestjs/common';

import { PlayerId } from '../common/player-id.decorator';
import { LeaderboardService } from './leaderboard.service';
import type { Leaderboard } from './leaderboard.types';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get()
  get(@PlayerId() playerId: string): Promise<Leaderboard> {
    return this.leaderboard.get(playerId);
  }
}
