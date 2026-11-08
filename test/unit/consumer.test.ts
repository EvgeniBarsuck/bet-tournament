import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { Logger } from '@nestjs/common';
import type { RmqContext } from '@nestjs/microservices';
import type { MessagePropertyHeaders } from 'amqplib';

import type { BetEvent } from '../../src/bets/bet-event';
import type { ApplyResult } from '../../src/bets/bets.constants';
import { BET_REJECTION } from '../../src/bets/bets.constants';
import { BetsConsumer } from '../../src/bets/bets.consumer';
import { BetRejectedError } from '../../src/bets/bets.errors';
import type { BetsService } from '../../src/bets/bets.service';
import { type Config, loadConfig } from '../../src/config/config';

Logger.overrideLogger(false);

const event: BetEvent = {
  betId: 'b1',
  playerId: 'p1',
  currency: 'USD',
  stake: '10',
  winAmount: '25',
  settledAt: '2026-11-06T10:00:00Z',
};

const config: Config = loadConfig({ DATABASE_URL: 'postgresql://x', RABBITMQ_URL: 'amqp://x' });

interface Published {
  exchange: string;
  routingKey: string;
  headers: MessagePropertyHeaders;
}

let replies: string[];
let published: Published[];
let confirmError: Error | null;

const message = {
  content: Buffer.from('{}'),
  properties: { headers: { 'x-delivery-count': 3, 'x-requeue-count': 2, trace: 't1' } },
};
const channel = {
  cancel: (tag: string) => {
    replies.push(`cancel(${tag})`);

    return Promise.resolve({ consumerTag: tag });
  },
  ack: () => replies.push('ack'),
  nack: (_: unknown, allUpTo: boolean, requeue: boolean) =>
    replies.push(`nack(requeue=${requeue}, allUpTo=${allUpTo})`),
  publish: (
    exchange: string,
    routingKey: string,
    _content: Buffer,
    options: { headers: MessagePropertyHeaders },
    confirmed: (error: Error | null) => void,
  ) => {
    replies.push(`publish(${exchange || '<default>'} → ${routingKey})`);
    published.push({ exchange, routingKey, headers: options.headers });
    setImmediate(() => confirmed(confirmError));

    return true;
  },
};
const context = {
  getChannelRef: () => channel,
  getMessage: () => message,
} as unknown as RmqContext;

function consumer(
  settle: () => Promise<ApplyResult>,
  delays: readonly number[] = [1, 1],
): BetsConsumer {
  const service = { settle, rollback: settle } as unknown as BetsService;

  return new BetsConsumer(service, config, delays);
}

const transient = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const DLQ = 'publish(bet.events.dlx → failed)';
const REQUEUE = 'publish(<default> → bet.events)';
const CANCEL = 'cancel(bet-tournament)';

beforeEach(() => {
  replies = [];
  published = [];
  confirmError = null;
});

void test('acks only after the operation has completed', async () => {
  let finish!: (result: ApplyResult) => void;
  const pending = consumer(() => new Promise((resolve) => (finish = resolve))).onSettled(
    event,
    context,
  );

  await tick();
  assert.deepEqual(replies, []);
  finish('settled');
  await pending;
  assert.deepEqual(replies, ['ack']);
});

void test('invalid payload goes to the DLQ with its code, without touching the database', async () => {
  let calls = 0;

  await consumer(() => {
    calls++;

    return Promise.resolve('settled');
  }).onSettled({ ...event, winAmount: 25 }, context);
  assert.equal(calls, 0);
  assert.deepEqual(replies, [DLQ, 'ack']);
  assert.equal(published[0]?.headers['x-rejection-code'], BET_REJECTION.INVALID_EVENT);
  assert.match(String(published[0]?.headers['x-rejection-reason']), /winAmount/);
});

void test('business errors go to the DLQ with code and reason, without retry', async () => {
  let calls = 0;

  await consumer(() => {
    calls++;

    return Promise.reject(new BetRejectedError(BET_REJECTION.OWNER_CONFLICT, 'conflict'));
  }).onRollback(event, context);
  assert.equal(calls, 1);
  assert.deepEqual(replies, [DLQ, 'ack']);

  const headers = published[0]?.headers ?? {};

  assert.equal(headers['x-rejection-code'], BET_REJECTION.OWNER_CONFLICT);
  assert.equal(headers['x-rejection-reason'], 'conflict');
  assert.equal(headers.trace, 't1', 'producer headers are kept');
  assert.equal(headers['x-delivery-count'], undefined, 'broker headers are dropped');
});

void test('if the DLQ copy is not confirmed, the queue dead-letters the original', async () => {
  confirmError = new Error('nacked by broker');
  await consumer(() =>
    Promise.reject(new BetRejectedError(BET_REJECTION.OWNER_CONFLICT, 'conflict')),
  ).onSettled(event, context);
  assert.deepEqual(replies, [DLQ, 'nack(requeue=false, allUpTo=false)']);
});

void test('transient DB errors are retried, then acked on success', async () => {
  let calls = 0;

  await consumer(() =>
    ++calls < 3 ? Promise.reject(transient()) : Promise.resolve('duplicate'),
  ).onSettled(event, context);
  assert.equal(calls, 3);
  assert.deepEqual(replies, ['ack']);
});

void test('exhausted retries republish to the queue, never to the DLQ', async () => {
  let calls = 0;

  await consumer(() => {
    calls++;

    return Promise.reject(transient());
  }).onSettled(event, context);
  assert.equal(calls, 3); // first attempt + 2 retries
  assert.deepEqual(replies, [REQUEUE, 'ack']);
  assert.equal(published[0]?.headers['x-requeue-count'], 3);
  assert.equal(published[0]?.headers['x-rejection-reason'], 'TRANSIENT_DB_ERROR');
});

void test('an unreachable database host is retried, not dead-lettered', async () => {
  const unresolved = Object.assign(new Error('getaddrinfo ENOTFOUND postgres'), {
    code: 'ENOTFOUND',
  });

  await consumer(() => Promise.reject(unresolved)).onSettled(event, context);
  assert.deepEqual(replies, [REQUEUE, 'ack']);
});

void test('if the requeued copy is not confirmed, the original is nacked back to the queue', async () => {
  confirmError = new Error('nacked by broker');
  await consumer(() => Promise.reject(transient())).onSettled(event, context);
  // Never left unacked: on a live channel it would hold a prefetch slot until consumer_timeout.
  assert.deepEqual(replies, [REQUEUE, 'nack(requeue=true, allUpTo=false)']);
});

void test('on a closed channel a failed copy leaves the original to the broker', async () => {
  confirmError = new Error('channel closed');

  const nack = channel.nack;

  channel.nack = () => {
    throw new Error('Channel closed');
  };

  try {
    await consumer(() => Promise.reject(transient())).onSettled(event, context);
  } finally {
    channel.nack = nack;
  }

  assert.deepEqual(replies, [REQUEUE]);
});

void test('shutdown stops retrying, republishes and waits for the in-flight message', async () => {
  let calls = 0;
  const subject = consumer(() => {
    calls++;

    return Promise.reject(transient());
  }, [60_000]);
  const started = Date.now();
  const pending = subject.onSettled(event, context);

  await tick();
  await subject.beforeApplicationShutdown();
  assert.deepEqual(
    replies,
    [CANCEL, REQUEUE, 'ack'],
    'consumer cancelled first, message settled before the hook returned',
  );
  assert.equal(published[0]?.headers['x-rejection-reason'], 'SHUTDOWN');
  await pending;
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 1_000, 'did not wait for the retry delay');
});

void test('shutdown waits for messages delivered before the cancel took effect', async () => {
  const finishers: ((result: ApplyResult) => void)[] = [];
  const subject = consumer(() => new Promise((resolve) => finishers.push(resolve)));
  const first = subject.onSettled(event, context);

  await tick();

  let drained = false;
  const shutdown = subject.beforeApplicationShutdown().then(() => (drained = true));
  const late = subject.onSettled(event, context); // was already on the wire

  await tick();
  finishers[0]?.('settled');
  await first;
  await tick();
  assert.equal(drained, false, 'still waiting for the late message');
  finishers[1]?.('duplicate');
  await Promise.all([late, shutdown]);
  assert.deepEqual(replies, [CANCEL, 'ack', 'ack']);
});

void test('a delivery after shutdown began cancels the consumer and is processed once', async () => {
  let calls = 0;
  const subject = consumer(() => {
    calls++;

    return Promise.reject(transient());
  }, [60_000]);

  await subject.beforeApplicationShutdown(); // no delivery yet: nothing to cancel on
  assert.deepEqual(replies, []);
  await subject.onSettled(event, context);
  await subject.onSettled(event, context);
  assert.equal(calls, 2, 'one attempt each, no retry delays');
  // Cancel goes out before the first copy, so the broker cannot redeliver it here.
  assert.deepEqual(replies, [CANCEL, REQUEUE, 'ack', REQUEUE, 'ack']);
});

void test('unexpected errors (bugs) go to the DLQ without retry', async () => {
  let calls = 0;

  await consumer(() => {
    calls++;

    return Promise.reject(new Error('impossible state'));
  }).onSettled(event, context);
  assert.equal(calls, 1);
  assert.deepEqual(replies, [DLQ, 'ack']);
  assert.equal(published[0]?.headers['x-rejection-code'], 'UNEXPECTED_ERROR');
});
