import 'dotenv/config';

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Leaderboard } from '../src/leaderboard/leaderboard.service';
import { publish, scenario } from './producer';

// End-to-end: producer → RabbitMQ → consumer → PostgreSQL → HTTP.
// Expects the default demo rates EUR=1.10, GBP=1.25.
const api = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

async function waitForPoints(playerId: string, expected: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let last = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${api}/leaderboard`, { headers: { 'X-Player-Id': playerId } });
    assert.equal(response.status, 200);
    last = ((await response.json()) as Leaderboard).player.points;
    if (last === expected) return;
    await sleep(200);
  }
  throw new Error(`${playerId}: expected ${expected} points, got ${last}`);
}

async function main(): Promise<void> {
  assert.equal((await fetch(`${api}/leaderboard`)).status, 400);
  const prefix = `smoke${Date.now()}`;
  const demo = scenario('demo', prefix);
  await publish([...demo, ...demo]); // every message delivered twice
  await waitForPoints(`${prefix}-alice`, '37.5');
  await waitForPoints(`${prefix}-bob`, '50');
  await publish(demo.map((message) => ({ ...message, pattern: 'bet.rollback' as const })));
  await waitForPoints(`${prefix}-alice`, '0');
  await waitForPoints(`${prefix}-bob`, '0');
  console.log('Smoke passed: duplicates counted once, rollbacks subtract the award');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
