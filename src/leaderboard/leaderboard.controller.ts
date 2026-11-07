import {
  BadRequestException,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
} from '@nestjs/common';

import { ID_PATTERN } from '../bets/bet-event';
import { type Leaderboard, LeaderboardService } from './leaderboard.service';

/** Reads and validates X-Player-Id. Identifies the player; it is not authentication. */
export const PlayerId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const value = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers[
    'x-player-id'
  ];
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new BadRequestException('X-Player-Id header is required: 1-128 chars [A-Za-z0-9_.:-]');
  }
  return value;
});

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get()
  get(@PlayerId() playerId: string): Promise<Leaderboard> {
    return this.leaderboard.get(playerId);
  }
}
