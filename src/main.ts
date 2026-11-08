import 'reflect-metadata';
import 'dotenv/config';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import { HTTP_HOST, LOG_FORMAT } from './config/config.constants';
import { BrokerStatus } from './messaging/broker-status';
import { CONSUMER_TAG } from './messaging/messaging.constants';
import { declareTopology, queueOptions, withChannel } from './messaging/topology';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger({ json: config.logFormat === LOG_FORMAT.JSON });

  Logger.overrideLogger(logger);
  await withChannel(config.rabbitmqUrl, (channel) => declareTopology(channel, config.queue));

  const app = await NestFactory.create(AppModule.register(config), { logger });
  const consumer = app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.rabbitmqUrl],
      queue: config.queue,
      queueOptions: queueOptions(config.queue),
      noAck: false, // ack manually, after commit
      prefetchCount: config.prefetch,
      consumerTag: CONSUMER_TAG, // cancelled by BetsConsumer on shutdown
    },
  });

  app.get(BrokerStatus).track(consumer.status);
  // Exit explicitly once the hooks are done. By default Nest re-raises the signal, but
  // in a container Node is PID 1 and the kernel ignores it; the process would then wait
  // for leftovers such as DNS lookups to a dead database host and be SIGKILLed.
  app.enableShutdownHooks(undefined, { useProcessExit: true });
  await app.startAllMicroservices();
  await app.listen(config.port, HTTP_HOST);
}

bootstrap().catch((error: unknown) => {
  new Logger(bootstrap.name).error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
