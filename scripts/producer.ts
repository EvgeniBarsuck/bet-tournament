import 'dotenv/config';

import type { BetEvent } from '../src/bets/bet-event';
import { BET_PATTERN, type BetPattern } from '../src/bets/bets.constants';
import { DEFAULT_QUEUE, MESSAGE_CONTENT_TYPE } from '../src/messaging/messaging.constants';
import { declareTopology, withChannel } from '../src/messaging/topology';

export interface Envelope {
  pattern: BetPattern;
  data: BetEvent;
}

export const SCENARIO = Object.freeze({
  DEMO: 'demo',
  DUPLICATE: 'duplicate',
  ROLLBACK: 'rollback',
  ROLLBACK_FIRST: 'rollback-first',
} as const);

/** Points after the demo scenario with rates USD=1, EUR=1.10, GBP=1.25; floored per bet. */
export const DEMO_EXPECTED_POINTS = Object.freeze({ alice: '37', bob: '50' });

const DEMO_STAKE = '10';
const DEMO_SETTLED_AT = '2026-11-06T10:00:00Z';

/** Publishes persistent messages and waits for broker confirms. */
/** Takes any JSON value, so tests can also publish deliberately invalid messages. */
export async function publish(messages: readonly unknown[]): Promise<void> {
  const url = process.env.RABBITMQ_URL;

  if (!url) throw new Error('RABBITMQ_URL is required');

  const queue = process.env.RABBITMQ_QUEUE ?? DEFAULT_QUEUE;

  await withChannel(url, async (channel) => {
    await declareTopology(channel, queue);

    for (const message of messages) {
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        contentType: MESSAGE_CONTENT_TYPE,
      });
    }

    await channel.waitForConfirms();
  });
}

/**
 * Demo scenarios:
 *   demo            alice 37 (10 USD + floor(27.5) for 25 EUR), bob 50 (40 GBP)
 *   duplicate       alice 10 (the same settle sent twice)
 *   rollback        alice 0 (settle, then rollback twice)
 *   rollback-first  alice 0 (rollback arrives before its settle)
 */
export function scenario(name: string, prefix: string): Envelope[] {
  const settle = (bet: string, player: string, currency: string, winAmount: string): Envelope => ({
    pattern: BET_PATTERN.SETTLED,
    data: {
      betId: `${prefix}-${bet}`,
      playerId: `${prefix}-${player}`,
      currency,
      stake: DEMO_STAKE,
      winAmount,
      settledAt: DEMO_SETTLED_AT,
    },
  });
  const rollback = (event: Envelope): Envelope => ({ ...event, pattern: BET_PATTERN.ROLLBACK });
  const a = settle('b1', 'alice', 'USD', '10');

  switch (name) {
    case SCENARIO.DEMO:
      return [a, settle('b2', 'alice', 'EUR', '25'), settle('b3', 'bob', 'GBP', '40')];
    case SCENARIO.DUPLICATE:
      return [a, a];
    case SCENARIO.ROLLBACK:
      return [a, rollback(a), rollback(a)];
    case SCENARIO.ROLLBACK_FIRST:
      return [rollback(a), a];
    default:
      throw new Error(`Scenario must be one of: ${Object.values(SCENARIO).join(', ')}`);
  }
}

if (require.main === module) {
  const [name = SCENARIO.DEMO, prefix = `run${Date.now()}`] = process.argv.slice(2);
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
