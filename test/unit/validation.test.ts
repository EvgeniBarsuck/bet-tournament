import assert from 'node:assert/strict';
import { test } from 'node:test';

import { betEventSchema } from '../../src/bets/bet-event';
import { loadConfig } from '../../src/config';

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

void test('config rejects numeric, zero and malformed rates', () => {
  for (const USD_RATES of ['{"EUR":1.1}', '{"EUR":"0"}', '{"eur":"1"}', 'not json']) {
    assert.throws(() => loadConfig({ ...env, USD_RATES }), USD_RATES);
  }
});
