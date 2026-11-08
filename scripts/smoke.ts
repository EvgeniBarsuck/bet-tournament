import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import type { ConfirmChannel, MessagePropertyHeaders } from 'amqplib';

import { BET_PATTERN, BET_REJECTION } from '../src/bets/bets.constants';
import { PLAYER_ID_HEADER } from '../src/common/player-id.decorator';
import { parseRates } from '../src/config/config';
import { CONFIG_DEFAULTS } from '../src/config/config.constants';
import { NO_POINTS } from '../src/leaderboard/leaderboard.constants';
import type { Leaderboard } from '../src/leaderboard/leaderboard.types';
import { DEFAULT_QUEUE, MESSAGE_HEADER } from '../src/messaging/messaging.constants';
import { deadLetterQueue, withChannel } from '../src/messaging/topology';
import { DEMO_EXPECTED_POINTS, DEMO_RATES, load, publish, SCENARIO, scenario } from './producer';

// End-to-end: producer → RabbitMQ → consumer → PostgreSQL → HTTP, and the DLQ.
// Expects the app to run with the demo rates (the Compose default) or the same USD_RATES.
const api = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? CONFIG_DEFAULTS.port}`;
const RESULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;
/** Random bets with duplicates and rollbacks in shuffled order; about 1.3 messages per bet. */
const LOAD_BETS = 500;
const LOAD_TIMEOUT_MS = 60_000;
/** Enough to look past older messages in a shared DLQ; unacked ones return on close. */
const DLQ_PREFETCH = 1_000;

/** How long the DLQ is watched to make sure an acked copy did not come back. */
const ABSENCE_CHECK_MS = 2_000;

/**
 * Watches the DLQ for the copy of a bet and returns its headers, or undefined if it
 * does not show up in time. With `take`, the copy is acked, i.e. removed from the DLQ;
 * otherwise it, like every other message seen, returns to the DLQ on channel close.
 */
async function findDeadLetter(
  betId: string,
  take: boolean,
  timeoutMs: number,
): Promise<MessagePropertyHeaders | undefined> {
  const url = process.env.RABBITMQ_URL;

  if (!url) throw new Error('RABBITMQ_URL is required');

  const queue = deadLetterQueue(process.env.RABBITMQ_QUEUE ?? DEFAULT_QUEUE);

  const watch = async (channel: ConfirmChannel) => {
    const found = Promise.withResolvers<MessagePropertyHeaders | undefined>();
    const timer = setTimeout(() => found.resolve(undefined), timeoutMs);

    await channel.prefetch(DLQ_PREFETCH);
    await channel.consume(queue, (message) => {
      if (!message?.content.toString().includes(betId)) return;

      if (take) channel.ack(message);

      clearTimeout(timer);
      found.resolve((message.properties as { headers?: MessagePropertyHeaders }).headers ?? {});
    });

    return found.promise;
  };

  return withChannel(url, watch);
}

async function pointsOf(playerId: string): Promise<string> {
  const response = await fetch(`${api}/leaderboard`, { headers: { [PLAYER_ID_HEADER]: playerId } });

  assert.equal(response.status, 200);

  return ((await response.json()) as Leaderboard).player.points;
}

async function waitForPoints(
  playerId: string,
  expected: string,
  timeoutMs = RESULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';

  while (Date.now() < deadline) {
    last = await pointsOf(playerId);

    if (last === expected) return;

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`${playerId}: expected ${expected} points, got ${last}`);
}

async function main(): Promise<void> {
  assert.equal((await fetch(`${api}/leaderboard`)).status, 400);

  const prefix = `smoke${Date.now()}`;
  const demo = scenario(SCENARIO.DEMO, prefix);

  await publish([...demo, ...demo]); // every message delivered twice
  await waitForPoints(`${prefix}-alice`, DEMO_EXPECTED_POINTS.alice);
  await waitForPoints(`${prefix}-bob`, DEMO_EXPECTED_POINTS.bob);
  await publish(demo.map((message) => ({ ...message, pattern: BET_PATTERN.ROLLBACK })));
  await waitForPoints(`${prefix}-alice`, NO_POINTS);
  await waitForPoints(`${prefix}-bob`, NO_POINTS);

  // A JSON number instead of a decimal string: rejected to the DLQ with its code.
  const invalid = `${prefix}-invalid`;

  await publish([
    { pattern: BET_PATTERN.SETTLED, data: { ...demo[0]?.data, betId: invalid, winAmount: 25 } },
  ]);

  const headers = await findDeadLetter(invalid, true, RESULT_TIMEOUT_MS);

  assert.ok(headers, `${invalid} did not reach the DLQ`);
  assert.equal(headers[MESSAGE_HEADER.REJECTION_CODE], BET_REJECTION.INVALID_EVENT);
  assert.match(String(headers[MESSAGE_HEADER.REJECTION_REASON]), /winAmount/);
  // The ack above must survive closing the connection (withChannel closes the channel first).
  assert.equal(
    await findDeadLetter(invalid, false, ABSENCE_CHECK_MS),
    undefined,
    'the acked DLQ copy came back',
  );

  // Load: every player's total must match floor(win × rate) summed in BigInt.
  const { messages, expected } = load(
    prefix,
    LOAD_BETS,
    parseRates(process.env.USD_RATES ?? DEMO_RATES),
  );

  await publish(messages);

  for (const [playerId, points] of expected) await waitForPoints(playerId, points, LOAD_TIMEOUT_MS);

  // A final pass: a transient match while messages were still in flight would differ now.
  for (const [playerId, points] of expected) assert.equal(await pointsOf(playerId), points);

  console.log(
    'Smoke passed: duplicates counted once, rollbacks subtract the award, ' +
      `invalid events reach the DLQ with a reason, ${messages.length} shuffled load messages add up`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
