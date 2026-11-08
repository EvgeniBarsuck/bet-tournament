import { type Channel, type ConfirmChannel, connect, type Options } from 'amqplib';

import {
  AMQP_CONNECT_TIMEOUT_MS,
  DEAD_LETTER_EXCHANGE_SUFFIX,
  DEAD_LETTER_QUEUE_SUFFIX,
  DEAD_LETTER_ROUTING_KEY,
  QUEUE_ARGUMENTS,
} from './messaging.constants';

export const deadLetterExchange = (queue: string) => `${queue}${DEAD_LETTER_EXCHANGE_SUFFIX}`;

export const deadLetterQueue = (queue: string) => `${queue}${DEAD_LETTER_QUEUE_SUFFIX}`;

/** Main queue: durable, dead-letters to `<queue>.dlx`, arguments in QUEUE_ARGUMENTS. */
export function queueOptions(queue: string): Options.AssertQueue {
  const deadLetter = {
    deadLetterExchange: deadLetterExchange(queue),
    deadLetterRoutingKey: DEAD_LETTER_ROUTING_KEY,
  };

  // A copy of the arguments: the Nest RMQ server may extend the options it is given.
  return { durable: true, ...deadLetter, arguments: { ...QUEUE_ARGUMENTS } };
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
