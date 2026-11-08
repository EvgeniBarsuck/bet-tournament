import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { Database } from './db/database';
import { HEALTH_STATUS, HEALTHY, type Healthy } from './health.constants';
import { BrokerStatus } from './messaging/broker-status';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly broker: BrokerStatus,
  ) {}

  /** Liveness: the process serves HTTP. Dependencies are not checked, so their outage does not restart it. */
  @Get('live')
  live(): Healthy {
    return HEALTHY;
  }

  /** Readiness: the database has the schema and the consumer is connected to RabbitMQ. */
  @Get('ready')
  async ready(): Promise<Healthy> {
    const database = await this.db.isReady();
    const broker = this.broker.isConnected();

    if (!database || !broker) {
      throw new ServiceUnavailableException({
        status: HEALTH_STATUS.UNAVAILABLE,
        database,
        broker,
      });
    }

    return HEALTHY;
  }
}
