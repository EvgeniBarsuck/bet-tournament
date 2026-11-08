import assert from 'node:assert/strict';
import { test } from 'node:test';

import { betEventSchema } from '../../src/bets/bet-event';
import { loadConfig } from '../../src/config/config';

const valid = {
  betId: 'bet-1',
  playerId: 'player-1',
  currency: 'EUR',
  stake: '10.00',
  winAmount: '25.5',
  settledAt: '2026-11-06T10:00:00Z',
};

void test('accepts a well-formed event and ignores extra fields', () => {
  assert.ok(betEventSchema.safeParse(valid).success);
  assert.ok(
    betEventSchema.safeParse({ ...valid, settledAt: '2026-11-06T10:00:00.123+03:00' }).success,
  );
  assert.ok(betEventSchema.safeParse({ ...valid, extra: true }).success);
});

void test('rejects money as JSON numbers, negatives, exponents and excess precision', () => {
  for (const winAmount of [25, '-1', '1e3', '1.123456789', '', '1.', '1234567890123']) {
    assert.equal(
      betEventSchema.safeParse({ ...valid, winAmount }).success,
      false,
      String(winAmount),
    );
  }
});

void test('rejects bad identifiers, currency and timestamps', () => {
  const bad = [
    { betId: '' },
    { playerId: 'a'.repeat(129) },
    { playerId: 'имя' },
    { currency: 'eur' },
    { currency: 'EURO' },
    { settledAt: '2026-11-06T10:00:00' }, // no timezone
    { settledAt: '2026-02-30T10:00:00Z' }, // no such day
    { settledAt: '0000-01-01T00:00:00Z' }, // no year 0 in PostgreSQL
    { settledAt: 'yesterday' },
  ];

  for (const override of bad) {
    assert.equal(
      betEventSchema.safeParse({ ...valid, ...override }).success,
      false,
      JSON.stringify(override),
    );
  }
});

const env = { DATABASE_URL: 'postgresql://x', RABBITMQ_URL: 'amqp://x' };

void test('config parses rates as decimal strings with defaults', () => {
  const config = loadConfig({ ...env, USD_RATES: '{"USD":"1","EUR":"1.10"}' });

  assert.equal(config.rates.get('EUR'), '1.10');
  assert.equal(config.queue, 'bet.events');
  assert.equal(loadConfig(env).rates.get('USD'), '1');
});

void test('config keeps a pool connection for every in-flight message plus HTTP', () => {
  assert.equal(loadConfig(env).dbPoolSize, 12, 'default prefetch 10 + 2 for HTTP');
  assert.equal(loadConfig({ ...env, PREFETCH: '16' }).dbPoolSize, 18);
  assert.equal(loadConfig({ ...env, PREFETCH: '10', DB_POOL_SIZE: '20' }).dbPoolSize, 20);
  assert.throws(() => loadConfig({ ...env, PREFETCH: '11', DB_POOL_SIZE: '12' }), /PREFETCH/);
  assert.throws(() => loadConfig({ ...env, PREFETCH: '1000' }), /DB_POOL_SIZE/);
});

void test('config defaults to JSON logs and accepts text', () => {
  assert.equal(loadConfig(env).logFormat, 'json');
  assert.equal(loadConfig({ ...env, LOG_FORMAT: 'text' }).logFormat, 'text');
  assert.throws(() => loadConfig({ ...env, LOG_FORMAT: 'xml' }));
});

void test('config rejects numeric, zero and malformed rates', () => {
  for (const USD_RATES of ['{"EUR":1.1}', '{"EUR":"0"}', '{"eur":"1"}', 'not json']) {
    assert.throws(() => loadConfig({ ...env, USD_RATES }), USD_RATES);
  }
});
