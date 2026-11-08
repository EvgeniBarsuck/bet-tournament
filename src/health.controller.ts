import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { Database } from './db/database';
import { BrokerStatus } from './messaging/broker-status';

const HEALTHY = Object.freeze({ status: 'ok' } as const);

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly broker: BrokerStatus,
  ) {}

  /** Liveness: the process serves HTTP. Dependencies are not checked, so their outage does not restart it. */
  @Get('live')
  live(): typeof HEALTHY {
    return HEALTHY;
  }

  /** Readiness: the database has the schema and the consumer is connected to RabbitMQ. */
  @Get('ready')
  async ready(): Promise<typeof HEALTHY> {
    const database = await this.db.isReady();
    const broker = this.broker.isConnected();

    if (!database || !broker) {
      throw new ServiceUnavailableException({ status: 'unavailable', database, broker });
    }

    return HEALTHY;
  }
}
