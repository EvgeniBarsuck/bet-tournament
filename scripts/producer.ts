import 'dotenv/config';

import { randomInt } from 'node:crypto';
import { once } from 'node:events';

import type { BetEvent } from '../src/bets/bet-event';
import { BET_PATTERN, type BetPattern } from '../src/bets/bets.constants';
import { parseRates } from '../src/config/config';
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
  LOAD: 'load',
} as const);

/** Rates of the demo; Compose and .env.example configure the app with the same ones. */
export const DEMO_RATES = '{"USD":"1","EUR":"1.10","GBP":"1.25"}';

/** Points after the demo scenario with DEMO_RATES; floored per bet. */
export const DEMO_EXPECTED_POINTS = Object.freeze({ alice: '37', bob: '50' });

const DEMO_STAKE = '10';
const DEMO_SETTLED_AT = '2026-11-06T10:00:00Z';

const DEFAULT_LOAD_BETS = 1_000;
const LOAD_PLAYERS = 20;
/** Percent of load bets whose settle is sent twice, and percent that are rolled back. */
const LOAD_DUPLICATE_PERCENT = 20;
const LOAD_ROLLBACK_PERCENT = 10;
/** Load wins are whole cents from 0 to 1000.00. */
const LOAD_MAX_WIN_CENTS = 100_000;
const CENT_DIGITS = 2;
/** Fractional digits of a rate: DECIMAL_PATTERN and the usd_rate column allow 8. */
const RATE_DIGITS = 8;

/**
 * Publishes persistent messages and waits for broker confirms.
 * Takes any JSON value, so tests can also publish deliberately invalid messages.
 */
export async function publish(messages: readonly unknown[]): Promise<void> {
  const url = process.env.RABBITMQ_URL;

  if (!url) throw new Error('RABBITMQ_URL is required');

  const queue = process.env.RABBITMQ_QUEUE ?? DEFAULT_QUEUE;

  await withChannel(url, async (channel) => {
    await declareTopology(channel, queue);

    for (const message of messages) {
      const accepted = channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        contentType: MESSAGE_CONTENT_TYPE,
      });

      // Back-pressure: wait until the socket buffer drains instead of growing it.
      if (!accepted) await once(channel, 'drain');
    }

    await channel.waitForConfirms();
  });
}

function settle(
  prefix: string,
  bet: string,
  player: string,
  currency: string,
  win: string,
): Envelope {
  const data: BetEvent = {
    betId: `${prefix}-${bet}`,
    playerId: `${prefix}-${player}`,
    currency,
    stake: DEMO_STAKE,
    winAmount: win,
    settledAt: DEMO_SETTLED_AT,
  };

  return { pattern: BET_PATTERN.SETTLED, data };
}

const rollback = (event: Envelope): Envelope => ({ ...event, pattern: BET_PATTERN.ROLLBACK });

/**
 * Fixed demo scenarios:
 *   demo            alice 37 (10 USD + floor(27.5) for 25 EUR), bob 50 (40 GBP)
 *   duplicate       alice 10 (the same settle sent twice)
 *   rollback        alice 0 (settle, then rollback twice)
 *   rollback-first  alice 0 (rollback arrives before its settle)
 */
export function scenario(name: string, prefix: string): Envelope[] {
  const a = settle(prefix, 'b1', 'alice', 'USD', '10');
  const b = settle(prefix, 'b2', 'alice', 'EUR', '25');
  const c = settle(prefix, 'b3', 'bob', 'GBP', '40');

  switch (name) {
    case SCENARIO.DEMO:
      return [a, b, c];
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

export interface Load {
  messages: Envelope[];
  /** Final points of every load player (`<prefix>-p<N>`), "0" included. */
  expected: Map<string, string>;
}

/**
 * Random bets of LOAD_PLAYERS players in every configured currency, in shuffled order:
 * some settles are sent twice, some bets are rolled back (the rollback may arrive
 * before its settle). Expected points are floor(win × rate) per bet, in BigInt.
 */
export function load(prefix: string, bets: number, rates: ReadonlyMap<string, string>): Load {
  const currencies = [...rates.keys()];
  const totals = new Map<string, bigint>();
  const messages: Envelope[] = [];

  for (let p = 0; p < LOAD_PLAYERS; p++) totals.set(`${prefix}-p${p}`, 0n);

  for (let i = 0; i < bets; i++) {
    const player = `p${randomInt(LOAD_PLAYERS)}`;
    const currency = currencies[randomInt(currencies.length)] ?? 'USD';
    const cents = BigInt(randomInt(LOAD_MAX_WIN_CENTS + 1));
    const win = `${cents / 100n}.${String(cents % 100n).padStart(CENT_DIGITS, '0')}`;
    const event = settle(prefix, `L${i}`, player, currency, win);

    messages.push(event);

    if (randomInt(100) < LOAD_DUPLICATE_PERCENT) messages.push(event);

    if (randomInt(100) < LOAD_ROLLBACK_PERCENT) {
      messages.push(rollback(event));
      continue;
    }

    const rate = toUnits(rates.get(currency) ?? '0', RATE_DIGITS);
    const points = (cents * rate) / 10n ** BigInt(CENT_DIGITS + RATE_DIGITS);
    const id = event.data.playerId;

    totals.set(id, (totals.get(id) ?? 0n) + points);
  }

  shuffle(messages);

  const expected = new Map([...totals].map(([player, points]) => [player, points.toString()]));

  return { messages, expected };
}

/** "1.1" with 8 digits → 110000000n: exact fixed-point, never a JS number. */
function toUnits(decimal: string, digits: number): bigint {
  const [whole = '0', fraction = ''] = decimal.split('.');

  return BigInt(whole + fraction.padEnd(digits, '0'));
}

function shuffle<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);

    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
}

async function main(name: string, prefix: string, count?: string): Promise<void> {
  if (name === SCENARIO.LOAD) {
    const bets = Number(count ?? DEFAULT_LOAD_BETS);

    if (!Number.isInteger(bets) || bets <= 0)
      throw new Error('Bet count must be a positive integer');

    const started = Date.now();
    const { messages, expected } = load(
      prefix,
      bets,
      parseRates(process.env.USD_RATES ?? DEMO_RATES),
    );

    await publish(messages);
    console.log(
      `Published ${messages.length} messages for ${bets} bets in ${Date.now() - started} ms. ` +
        'Expected points once the queue drains:',
    );
    console.table(
      [...expected]
        .sort(([, a], [, b]) => Number(BigInt(b) - BigInt(a)))
        .map(([playerId, points]) => ({ playerId, points })),
    );

    return;
  }

  const messages = scenario(name, prefix);

  await publish(messages);
  console.log(`Published ${messages.length} messages, players: ${prefix}-alice, ${prefix}-bob`);
}

if (require.main === module) {
  const [name = SCENARIO.DEMO, prefix = `run${Date.now()}`, count] = process.argv.slice(2);

  main(name, prefix, count).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
