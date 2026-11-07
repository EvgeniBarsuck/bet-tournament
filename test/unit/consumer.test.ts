import { Logger } from '@nestjs/common';
import type { RmqContext } from '@nestjs/microservices';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { type BetEvent, PermanentError } from '../../src/bets/bet-event';
import { BetsConsumer } from '../../src/bets/bets.consumer';
import type { ApplyResult, BetsService } from '../../src/bets/bets.service';

Logger.overrideLogger(false);

const event: BetEvent = {
  betId: 'b1',
  playerId: 'p1',
  currency: 'USD',
  stake: '10',
  winAmount: '25',
  settledAt: '2026-11-06T10:00:00Z',
};

let replies: string[];
const message = { content: Buffer.from('') };
const channel = {
  ack: () => replies.push('ack'),
  nack: (_: unknown, allUpTo: boolean, requeue: boolean) =>
    replies.push(`nack(requeue=${requeue}, allUpTo=${allUpTo})`),
};
const context = {
  getChannelRef: () => channel,
  getMessage: () => message,
} as unknown as RmqContext;

function consumer(settle: () => Promise<ApplyResult>): BetsConsumer {
  const service = { settle, rollback: settle } as unknown as BetsService;
  return new BetsConsumer(service, [1, 1]);
}

const transient = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });

beforeEach(() => {
  replies = [];
});

void test('acks only after the operation has completed', async () => {
  let finish!: (result: ApplyResult) => void;
  const pending = consumer(() => new Promise((resolve) => (finish = resolve))).onSettled(
    event,
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(replies, []);
  finish('settled');
  await pending;
  assert.deepEqual(replies, ['ack']);
});

void test('invalid payload goes to the DLQ without touching the database', async () => {
  let calls = 0;
  await consumer(() => {
    calls++;
    return Promise.resolve('settled');
  }).onSettled({ ...event, winAmount: 25 }, context);
  assert.equal(calls, 0);
  assert.deepEqual(replies, ['nack(requeue=false, allUpTo=false)']);
});

void test('business errors go to the DLQ without retry', async () => {
  let calls = 0;
  await consumer(() => {
    calls++;
    return Promise.reject(new PermanentError('conflict'));
  }).onRollback(event, context);
  assert.equal(calls, 1);
  assert.deepEqual(replies, ['nack(requeue=false, allUpTo=false)']);
});

void test('transient DB errors are retried, then acked on success', async () => {
  let calls = 0;
  await consumer(() =>
    ++calls < 3 ? Promise.reject(transient()) : Promise.resolve('duplicate'),
  ).onSettled(event, context);
  assert.equal(calls, 3);
  assert.deepEqual(replies, ['ack']);
});

void test('exhausted retries go to the DLQ', async () => {
  let calls = 0;
  await consumer(() => {
    calls++;
    return Promise.reject(transient());
  }).onSettled(event, context);
  assert.equal(calls, 3); // first attempt + 2 retries
  assert.deepEqual(replies, ['nack(requeue=false, allUpTo=false)']);
});
