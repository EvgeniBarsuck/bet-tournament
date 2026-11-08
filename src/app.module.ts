import { DynamicModule, Module } from '@nestjs/common';

import { BetsModule } from './bets/bets.module';
import type { Config } from './config/config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health.controller';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { MessagingModule } from './messaging/messaging.module';

@Module({})
export class AppModule {
  static register(config: Config): DynamicModule {
    const imports = [
      ConfigModule.forRoot(config),
      DatabaseModule,
      MessagingModule,
      BetsModule,
      LeaderboardModule,
    ];

    return { module: AppModule, imports, controllers: [HealthController] };
  }
}
