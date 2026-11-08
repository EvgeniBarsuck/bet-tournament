import { Module } from '@nestjs/common';

import { BetsConsumer } from './bets.consumer';
import { BetsRepository } from './bets.repository';
import { BetsService } from './bets.service';

@Module({
  providers: [BetsService, BetsRepository],
  controllers: [BetsConsumer],
})
export class BetsModule {}
