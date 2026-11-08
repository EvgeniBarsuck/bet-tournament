import { setTimeout as sleep } from 'node:timers/promises';

import { BeforeApplicationShutdown, Controller, Inject, Logger, Optional } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import type { ConfirmChannel, Message } from 'amqplib';

import { CONFIG, type Config } from '../config/config';
import { isTransientDbError, withRetry } from '../db/retry';
import {
  CONSUMER_TAG,
  DEAD_LETTER_ROUTING_KEY,
  MAX_REASON_LENGTH,
  MESSAGE_HEADER,
} from '../messaging/messaging.constants';
import { republish } from '../messaging/republish';
import { deadLetterExchange } from '../messaging/topology';
import { type BetEvent, betEventSchema } from './bet-event';
import {
  type ApplyResult,
  BET_PATTERN,
  BET_REJECTION,
  type BetPattern,
  CONSUMER_OUTCOME,
  DRAIN_TIMEOUT_MS,
  REQUEUE_REASON,
  RETRY_DELAYS,
  RETRY_DELAYS_MS,
  UNEXPECTED_ERROR,
} from './bets.constants';
import { BetRejectedError } from './bets.errors';
import { BetsService } from './bets.service';

type RequeueReason = (typeof REQUEUE_REASON)[keyof typeof REQUEUE_REASON];

/**
 * Messages are acknowledged only after the transaction commits. Error handling:
 * - business rejection (invalid payload, conflict, unknown currency): a copy with
 *   x-rejection-code/x-rejection-reason goes to the DLQ, then the original is acked;
 * - transient DB error: the transaction is retried, then a copy is republished to the
 *   end of the queue. A database outage pauses processing, it never fills the DLQ;
 * - anything else is a bug: DLQ with code UNEXPECTED_ERROR, error with stack.
 * A copy is published with broker confirms before the original is acked. If the copy
 * cannot be published, the original is left to the broker: nothing is lost, at worst
 * the message is processed twice, which is a no-op.
 * Unknown patterns and malformed JSON are dead-lettered by Nest itself, without headers.
 */
@Controller()
export class BetsConsumer implements BeforeApplicationShutdown {
  private readonly logger = new Logger(BetsConsumer.name);
  private readonly shutdown = new AbortController();
  private readonly inFlight = new Set<Promise<void>>();
  /** Channel of the latest delivery: the one the consumer has to be cancelled on. */
  private channel?: ConfirmChannel;
  private cancelled?: Promise<void>;

  constructor(
    private readonly bets: BetsService,
    @Inject(CONFIG) private readonly config: Config,
    @Optional()
    @Inject(RETRY_DELAYS)
    private readonly retryDelays: readonly number[] = RETRY_DELAYS_MS,
  ) {}

  /**
   * Runs before Nest closes the RMQ channel and the DB pool:
   * 1. cancels the consumer, so the broker stops delivering new messages;
   * 2. stops retry delays: a message waiting for the database is republished;
   * 3. waits until every delivered message is acked or republished.
   * A message still unacked when the channel closes would cost one delivery from
   * x-delivery-limit, so shutdown leaves none behind unless the drain times out.
   */
  async beforeApplicationShutdown(): Promise<void> {
    // The cancel frame is written before abort wakes any retry, so it precedes every copy.
    const cancelled = this.channel && this.stopConsuming(this.channel);

    this.shutdown.abort();
    await cancelled;

    const deadline = Date.now() + DRAIN_TIMEOUT_MS;

    // Loop: messages delivered before the cancel took effect join the set later.
    while (this.inFlight.size > 0) {
      const remaining = deadline - Date.now();

      if (remaining <= 0) {
        this.logger.warn(`Shutdown drain timed out, ${this.inFlight.size} message(s) left`);

        return;
      }

      await Promise.race([
        Promise.allSettled([...this.inFlight]),
        sleep(remaining, undefined, { ref: false }),
      ]);
    }
  }

  /** basic.cancel; the broker delivers nothing on this consumer tag after it. Runs once. */
  private stopConsuming(channel: ConfirmChannel): Promise<void> {
    this.cancelled ??= channel.cancel(CONSUMER_TAG).then(
      () => undefined,
      (error: unknown) => this.logger.warn(`Cannot cancel the consumer: ${String(error)}`),
    );

    return this.cancelled;
  }

  @EventPattern<string>(BET_PATTERN.SETTLED)
  onSettled(@Payload() data: unknown, @Ctx() context: RmqContext): Promise<void> {
    return this.track(
      this.handle(BET_PATTERN.SETTLED, data, context, (event) => this.bets.settle(event)),
    );
  }

  @EventPattern<string>(BET_PATTERN.ROLLBACK)
  onRollback(@Payload() data: unknown, @Ctx() context: RmqContext): Promise<void> {
    return this.track(
      this.handle(BET_PATTERN.ROLLBACK, data, context, (event) => this.bets.rollback(event)),
    );
  }

  private track(work: Promise<void>): Promise<void> {
    this.inFlight.add(work);

    return work.finally(() => this.inFlight.delete(work));
  }

  private async handle(
    pattern: BetPattern,
    data: unknown,
    context: RmqContext,
    apply: (event: BetEvent) => Promise<ApplyResult>,
  ): Promise<void> {
    // The Nest RMQ server consumes on a confirm channel (amqp-connection-manager default).
    const channel = context.getChannelRef() as ConfirmChannel;
    const message = context.getMessage() as Message;

    this.channel = channel;

    // Shutdown began before any delivery, so the consumer is cancelled only now. The
    // cancel goes out before any republish of this message, so the broker cannot hand
    // the copy back to this consumer. The message itself is processed as usual, but
    // without retry delays: an aborted signal turns a transient error into a requeue.
    if (this.shutdown.signal.aborted) void this.stopConsuming(channel);

    const parsed = betEventSchema.safeParse(data);

    if (!parsed.success) {
      const reason = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');

      this.logger.warn({
        pattern,
        result: CONSUMER_OUTCOME.REJECTED,
        code: BET_REJECTION.INVALID_EVENT,
        reason,
      });
      await this.deadLetter(channel, message, BET_REJECTION.INVALID_EVENT, reason);

      return;
    }

    const { betId, playerId } = parsed.data;
    const log = { pattern, betId, playerId };

    try {
      const result = await withRetry(
        () => apply(parsed.data),
        this.retryDelays,
        (attempt, error) =>
          this.logger.warn({
            ...log,
            result: CONSUMER_OUTCOME.RETRY,
            attempt,
            reason: String(error),
          }),
        this.shutdown.signal,
      );

      this.settle(() => channel.ack(message));
      this.logger.log({ ...log, result });
    } catch (error) {
      if (isAbort(error) || isTransientDbError(error)) {
        const interrupted = this.shutdown.signal.aborted;

        this.logger.warn({
          ...log,
          result: interrupted ? CONSUMER_OUTCOME.INTERRUPTED : CONSUMER_OUTCOME.REQUEUED,
          reason: String(error),
        });
        await this.requeue(
          channel,
          message,
          interrupted ? REQUEUE_REASON.SHUTDOWN : REQUEUE_REASON.TRANSIENT_DB_ERROR,
        );

        return;
      }

      if (error instanceof BetRejectedError) {
        this.logger.warn({
          ...log,
          result: CONSUMER_OUTCOME.REJECTED,
          code: error.code,
          reason: error.message,
        });
        await this.deadLetter(channel, message, error.code, error.message);

        return;
      }

      const stack = error instanceof Error ? error.stack : String(error);

      this.logger.error(
        {
          ...log,
          result: CONSUMER_OUTCOME.REJECTED,
          code: UNEXPECTED_ERROR,
          reason: String(error),
        },
        stack,
      );
      await this.deadLetter(channel, message, UNEXPECTED_ERROR, String(error));
    }
  }

  /** Copy to the DLQ with the reason, then ack. Falls back to the queue's own DLX. */
  private async deadLetter(
    channel: ConfirmChannel,
    message: Message,
    code: string,
    reason: string,
  ): Promise<void> {
    try {
      await republish(
        channel,
        deadLetterExchange(this.config.queue),
        DEAD_LETTER_ROUTING_KEY,
        message,
        {
          [MESSAGE_HEADER.REJECTION_CODE]: code,
          [MESSAGE_HEADER.REJECTION_REASON]: reason.slice(0, MAX_REASON_LENGTH),
          [MESSAGE_HEADER.REJECTED_AT]: new Date().toISOString(),
        },
      );
      this.settle(() => channel.ack(message));
    } catch (error) {
      this.logger.warn(`Cannot publish to the DLQ, using nack instead: ${String(error)}`);
      this.settle(() => channel.nack(message, false, false));
    }
  }

  /**
   * Copy to the end of the queue, then ack. Unlike nack with requeue, this does not
   * count against the delivery limit, so a long outage cannot push messages to the DLQ.
   */
  private async requeue(
    channel: ConfirmChannel,
    message: Message,
    reason: RequeueReason,
  ): Promise<void> {
    const previous = Number(message.properties.headers?.[MESSAGE_HEADER.REQUEUE_COUNT] ?? 0);

    try {
      await republish(channel, '', this.config.queue, message, {
        [MESSAGE_HEADER.REQUEUE_COUNT]: previous + 1,
        [MESSAGE_HEADER.REJECTION_REASON]: reason,
      });
      this.settle(() => channel.ack(message));
    } catch (error) {
      // The original stays unacked: the broker redelivers it when the channel closes.
      this.logger.warn(`Cannot republish the message, leaving it to the broker: ${String(error)}`);
    }
  }

  // If the channel is already closed the broker redelivers the message, which is safe.
  private settle(send: () => void): void {
    try {
      send();
    } catch (error) {
      this.logger.warn(`Cannot ack/nack on a closed channel: ${String(error)}`);
    }
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
