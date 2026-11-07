import { type Channel, type ConfirmChannel, connect } from 'amqplib';

/** Main queue options: rejected messages are dead-lettered to `<queue>.dlq`. */
export function queueOptions(queue: string) {
  return {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': `${queue}.dlx`,
      'x-dead-letter-routing-key': 'failed',
    },
  };
}

export async function declareTopology(channel: Channel, queue: string): Promise<void> {
  await channel.assertExchange(`${queue}.dlx`, 'direct', { durable: true });
  await channel.assertQueue(`${queue}.dlq`, { durable: true });
  await channel.bindQueue(`${queue}.dlq`, `${queue}.dlx`, 'failed');
  await channel.assertQueue(queue, queueOptions(queue));
}

export async function withChannel<T>(
  url: string,
  operation: (channel: ConfirmChannel) => Promise<T>,
): Promise<T> {
  const connection = await connect(url, { timeout: 5_000 });
  try {
    return await operation(await connection.createConfirmChannel());
  } finally {
    await connection.close().catch(() => undefined);
  }
}
