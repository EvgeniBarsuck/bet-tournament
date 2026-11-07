import 'reflect-metadata';
import 'dotenv/config';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';

import { AppModule } from '../../src/app.module';
import { type BetEvent, PermanentError } from '../../src/bets/bet-event';
import { BetsService } from '../../src/bets/bets.service';
import { loadConfig } from '../../src/config';
import { Database } from '../../src/db/database';
import { migrate } from '../../src/db/migrate';
import { LeaderboardService } from '../../src/leaderboard/leaderboard.service';

// Runs against a real PostgreSQL in a throwaway schema of a *_test database.
const schema = `it_${randomUUID().replaceAll('-', '')}`;
let admin: Pool;
let app: INestApplication;
let pool: Pool;
let bets: BetsService;
let leaderboard: LeaderboardService;

before(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw || !new URL(raw).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database');
  }
  admin = new Pool({ connectionString: raw });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(raw);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const config = loadConfig({
    DATABASE_URL: url.toString(),
    RABBITMQ_URL: 'amqp://unused',
    USD_RATES: '{"USD":"1","EUR":"1.10","GBP":"1.25"}',
  });
  app = await NestFactory.create(AppModule.register(config), { logger: false });
  await app.listen(0, '127.0.0.1');
  pool = app.get(Database).pool;
  await migrate(pool);
  bets = app.get(BetsService);
  leaderboard = app.get(LeaderboardService);
});

beforeEach(async () => {
  await pool.query('TRUNCATE bets, player_scores');
});

after(async () => {
  await app?.close();
  await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin?.end();
});

function bet(overrides: Partial<BetEvent> = {}): BetEvent {
  return {
    betId: 'b1',
    playerId: 'p1',
    currency: 'USD',
    stake: '10',
    winAmount: '25',
    settledAt: '2026-11-06T10:00:00Z',
    ...overrides,
  };
}

const points = async (playerId = 'p1') => (await leaderboard.get(playerId)).player.points;
const isPermanent = (error: unknown) => error instanceof PermanentError;

void test('settle converts to USD exactly and awards once per bet', async () => {
  assert.equal(await bets.settle(bet({ currency: 'EUR', winAmount: '0.1' })), 'settled');
  assert.equal(await points(), '0.11');
  assert.equal(await bets.settle(bet({ currency: 'EUR', winAmount: '0.10' })), 'duplicate');
  assert.equal(
    await bets.settle(
      bet({ currency: 'EUR', winAmount: '0.1', settledAt: '2026-11-06T13:00:00+03:00' }),
    ),
    'duplicate',
  );
  assert.equal(await points(), '0.11');
});

void test('a resent bet with different values or another owner is rejected', async () => {
  await bets.settle(bet());
  await assert.rejects(bets.settle(bet({ winAmount: '26' })), isPermanent);
  await assert.rejects(bets.settle(bet({ playerId: 'p2' })), isPermanent);
  await assert.rejects(bets.rollback(bet({ playerId: 'p2' })), isPermanent);
  assert.equal(await points(), '25');
  assert.equal(await points('p2'), '0');
});

void test('unknown currency is rejected and leaves nothing behind', async () => {
  await assert.rejects(bets.settle(bet({ currency: 'JPY' })), isPermanent);
  assert.equal((await pool.query('SELECT 1 FROM bets')).rowCount, 0);
});

void test('rollback subtracts the saved award; repeated rollback is a no-op', async () => {
  await bets.settle(bet({ betId: 'b1', currency: 'GBP', winAmount: '40' }));
  await bets.settle(bet({ betId: 'b2', winAmount: '5' }));
  assert.equal(await points(), '55');
  // Amounts in the rollback event are ignored: the saved award is subtracted.
  assert.equal(await bets.rollback(bet({ betId: 'b1', winAmount: '0' })), 'rolled_back');
  assert.equal(await bets.rollback(bet({ betId: 'b1' })), 'duplicate');
  assert.equal(await points(), '5');
});

void test('rollback before settle is final: the late settle awards nothing', async () => {
  assert.equal(await bets.rollback(bet()), 'rolled_back');
  assert.equal(await bets.settle(bet()), 'ignored');
  assert.equal(await bets.rollback(bet()), 'duplicate');
  assert.deepEqual((await leaderboard.get('p1')).player, {
    playerId: 'p1',
    points: '0',
    position: null,
  });
});

void test('concurrent duplicates of one bet are awarded exactly once', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => bets.settle(bet())));
  assert.deepEqual(results.filter((r) => r === 'settled').length, 1);
  assert.equal(await points(), '25');
});

void test('concurrent bets of one player all count', async () => {
  await Promise.all(
    Array.from({ length: 8 }, (_, i) => bets.settle(bet({ betId: `b${i}`, winAmount: '1.5' }))),
  );
  assert.equal(await points(), '12');
});

void test('racing settle and rollback of one bet always end at zero', async () => {
  for (let i = 0; i < 10; i++) {
    const event = bet({ betId: `race${i}` });
    await Promise.all([bets.settle(event), bets.rollback(event)]);
  }
  assert.equal(await points(), '0');
});

void test('leaderboard: top 100, ties by playerId, zero scores excluded, own position', async () => {
  // 105 players with equal points + one leader + one player with zero points.
  for (let i = 0; i < 105; i++) {
    await bets.settle(
      bet({ betId: `t${i}`, playerId: `p${String(i).padStart(3, '0')}`, winAmount: '1' }),
    );
  }
  await bets.settle(bet({ betId: 'lead', playerId: 'zed', winAmount: '100' }));
  await bets.settle(bet({ betId: 'zero', playerId: 'nobody', winAmount: '0' }));

  const board = await leaderboard.get('p104');
  assert.equal(board.top.length, 100);
  assert.deepEqual(board.top[0], { playerId: 'zed', points: '100', position: 1 });
  assert.deepEqual(board.top[1], { playerId: 'p000', points: '1', position: 2 });
  assert.deepEqual(board.top[99], { playerId: 'p098', points: '1', position: 100 });
  assert.deepEqual(board.player, { playerId: 'p104', points: '1', position: 106 });
  assert.equal((await leaderboard.get('nobody')).player.position, null);
});

void test('HTTP: X-Player-Id is required and validated', async () => {
  const url = `${await app.getUrl()}/leaderboard`;
  assert.equal((await fetch(url)).status, 400);
  assert.equal((await fetch(url, { headers: { 'X-Player-Id': 'bad id' } })).status, 400);
  const response = await fetch(url, { headers: { 'X-Player-Id': 'p1' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    top: [],
    player: { playerId: 'p1', points: '0', position: null },
  });
});
