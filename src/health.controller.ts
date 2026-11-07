import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { Database } from './db/database';

@Controller('health')
export class HealthController {
  constructor(private readonly db: Database) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.db.pool.query('SELECT 1 FROM bets LIMIT 1');
    } catch {
      throw new ServiceUnavailableException('Database or schema unavailable');
    }
    return { status: 'ok' };
  }
}
