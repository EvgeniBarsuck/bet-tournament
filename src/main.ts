import 'reflect-metadata';
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';
import { loadConfig } from './config';
import { declareTopology, queueOptions, withChannel } from './messaging/topology';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  await withChannel(config.rabbitmqUrl, (channel) => declareTopology(channel, config.queue));

  const app = await NestFactory.create(AppModule.register(config));
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.rabbitmqUrl],
      queue: config.queue,
      queueOptions: queueOptions(config.queue),
      noAck: false, // ack manually, after commit
      prefetchCount: config.prefetch,
    },
  });
  app.enableShutdownHooks();
  await app.startAllMicroservices();
  await app.listen(config.port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
