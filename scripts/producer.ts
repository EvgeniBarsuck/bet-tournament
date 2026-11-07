import 'dotenv/config';

import { BET_ROLLBACK, BET_SETTLED, type BetEvent } from '../src/bets/bet-event';
import { declareTopology, withChannel } from '../src/messaging/topology';

interface Envelope {
  pattern: typeof BET_SETTLED | typeof BET_ROLLBACK;
  data: BetEvent;
}

/** Publishes persistent messages and waits for broker confirms. */
export async function publish(messages: Envelope[]): Promise<void> {
  const url = process.env.RABBITMQ_URL;
  if (!url) throw new Error('RABBITMQ_URL is required');
  const queue = process.env.RABBITMQ_QUEUE ?? 'bet.events';
  await withChannel(url, async (channel) => {
    await declareTopology(channel, queue);
    for (const message of messages) {
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        contentType: 'application/json',
      });
    }
    await channel.waitForConfirms();
  });
}

/**
 * Demo scenarios. With rates USD=1, EUR=1.10, GBP=1.25:
 *   demo            alice 37.5 (10 USD + 25 EUR), bob 50 (40 GBP)
 *   duplicate       alice 10 (the same settle sent twice)
 *   rollback        alice 0 (settle, then rollback twice)
 *   rollback-first  alice 0 (rollback arrives before its settle)
 */
export function scenario(name: string, prefix: string): Envelope[] {
  const settle = (bet: string, player: string, currency: string, winAmount: string): Envelope => ({
    pattern: BET_SETTLED,
    data: {
      betId: `${prefix}-${bet}`,
      playerId: `${prefix}-${player}`,
      currency,
      stake: '10',
      winAmount,
      settledAt: '2026-11-06T10:00:00Z',
    },
  });
  const rollback = (event: Envelope): Envelope => ({ ...event, pattern: BET_ROLLBACK });
  const a = settle('b1', 'alice', 'USD', '10');
  switch (name) {
    case 'demo':
      return [a, settle('b2', 'alice', 'EUR', '25'), settle('b3', 'bob', 'GBP', '40')];
    case 'duplicate':
      return [a, a];
    case 'rollback':
      return [a, rollback(a), rollback(a)];
    case 'rollback-first':
      return [rollback(a), a];
    default:
      throw new Error('Scenario must be one of: demo, duplicate, rollback, rollback-first');
  }
}

if (require.main === module) {
  const [name = 'demo', prefix = `run${Date.now()}`] = process.argv.slice(2);
  const messages = scenario(name, prefix);
  publish(messages)
    .then(() =>
      console.log(`Published ${messages.length} messages, players: ${prefix}-alice, ${prefix}-bob`),
    )
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
