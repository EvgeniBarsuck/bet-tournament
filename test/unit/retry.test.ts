import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTransientDbError, withRetry } from '../../src/db/retry';

const pgError = (code: string) => Object.assign(new Error(code), { code });

void test('only lock, serialization and connection failures are transient', () => {
  for (const code of ['40001', '40P01', '55P03', '08006', 'ECONNRESET']) {
    assert.equal(isTransientDbError(pgError(code)), true, code);
  }
  for (const code of ['23505', '23514', '22P02', '42P01']) {
    assert.equal(isTransientDbError(pgError(code)), false, code);
  }
  assert.equal(isTransientDbError(new Error('Connection terminated unexpectedly')), true);
  assert.equal(isTransientDbError(new Error('boom')), false);
});

void test('withRetry re-runs the whole operation, then gives up', async () => {
  let calls = 0;
  const attempts: number[] = [];
  await assert.rejects(
    withRetry(
      () => {
        calls++;
        return Promise.reject(pgError('40P01'));
      },
      [1, 1],
      (attempt) => attempts.push(attempt),
    ),
    { code: '40P01' },
  );
  assert.equal(calls, 3);
  assert.deepEqual(attempts, [1, 2]);
});
