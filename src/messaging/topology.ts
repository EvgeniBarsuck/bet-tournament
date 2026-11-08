import { type Channel, type ConfirmChannel, connect, type Options } from 'amqplib';

import {
  AMQP_CONNECT_TIMEOUT_MS,
  DEAD_LETTER_EXCHANGE_SUFFIX,
  DEAD_LETTER_QUEUE_SUFFIX,
  DEAD_LETTER_ROUTING_KEY,
  DELIVERY_LIMIT,
} from './messaging.constants';

export const deadLetterExchange = (queue: string) => `${queue}${DEAD_LETTER_EXCHANGE_SUFFIX}`;

export const deadLetterQueue = (queue: string) => `${queue}${DEAD_LETTER_QUEUE_SUFFIX}`;

/**
 * Main queue: quorum, with a delivery limit against messages that crash the
 * consumer. Dead-lettering is at-least-once, which requires reject-publish overflow.
 * The arguments must match an existing queue exactly: a classic queue created by an
 * older version has to be deleted (when empty) before the app starts.
 */
export function queueOptions(queue: string): Options.AssertQueue {
  return {
    durable: true,
    deadLetterExchange: deadLetterExchange(queue),
    deadLetterRoutingKey: DEAD_LETTER_ROUTING_KEY,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': DELIVERY_LIMIT,
      'x-dead-letter-strategy': 'at-least-once',
      'x-overflow': 'reject-publish',
    },
  };
}

/**
 * The DLQ stays classic: it is read by people and tools, and re-reading a quorum
 * queue would count against its default delivery limit and eventually drop messages.
 */
export async function declareTopology(channel: Channel, queue: string): Promise<void> {
  await channel.assertExchange(deadLetterExchange(queue), 'direct', { durable: true });
  await channel.assertQueue(deadLetterQueue(queue), { durable: true });
  await channel.bindQueue(
    deadLetterQueue(queue),
    deadLetterExchange(queue),
    DEAD_LETTER_ROUTING_KEY,
  );
  await channel.assertQueue(queue, queueOptions(queue));
}

export async function withChannel<T>(
  url: string,
  operation: (channel: ConfirmChannel) => Promise<T>,
): Promise<T> {
  const connection = await connect(url, { timeout: AMQP_CONNECT_TIMEOUT_MS });

  try {
    const channel = await connection.createConfirmChannel();

    try {
      return await operation(channel);
    } finally {
      // Close the channel first: its close-ok arrives only after the broker has
      // processed earlier acks. Closing just the connection can lose them.
      await channel.close().catch(() => undefined);
    }
  } finally {
    await connection.close().catch(() => undefined);
  }
}
