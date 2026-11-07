import { DynamicModule, Module } from '@nestjs/common';

import { BetsModule } from './bets/bets.module';
import type { Config } from './config';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health.controller';
import { LeaderboardModule } from './leaderboard/leaderboard.module';

@Module({})
export class AppModule {
  static register(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.forRoot(config), BetsModule, LeaderboardModule],
      controllers: [HealthController],
    };
  }
}
