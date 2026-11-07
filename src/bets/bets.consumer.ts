import { Controller, Inject, Logger, Optional } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import type { Channel, Message } from 'amqplib';

import { withRetry } from '../db/retry';
import { BET_ROLLBACK, BET_SETTLED, type BetEvent, betEventSchema } from './bet-event';
import { type ApplyResult, BetsService } from './bets.service';

/** Delays before re-running a transaction that failed with a transient DB error. */
export const RETRY_DELAYS_MS = [200, 1_000, 5_000];
export const RETRY_DELAYS = Symbol('RETRY_DELAYS');

/**
 * Messages are acknowledged only after the transaction commits. Anything that
 * cannot succeed (invalid payload, conflict, unknown currency) goes to the DLQ.
 * Unknown patterns and malformed JSON are rejected to the DLQ by Nest itself.
 */
@Controller()
export class BetsConsumer {
  private readonly logger = new Logger(BetsConsumer.name);

  constructor(
    private readonly bets: BetsService,
    @Optional()
    @Inject(RETRY_DELAYS)
    private readonly retryDelays: readonly number[] = RETRY_DELAYS_MS,
  ) {}

  @EventPattern<string>(BET_SETTLED)
  onSettled(@Payload() data: unknown, @Ctx() context: RmqContext): Promise<void> {
    return this.handle(BET_SETTLED, data, context, (event) => this.bets.settle(event));
  }

  @EventPattern<string>(BET_ROLLBACK)
  onRollback(@Payload() data: unknown, @Ctx() context: RmqContext): Promise<void> {
    return this.handle(BET_ROLLBACK, data, context, (event) => this.bets.rollback(event));
  }

  private async handle(
    pattern: string,
    data: unknown,
    context: RmqContext,
    apply: (event: BetEvent) => Promise<ApplyResult>,
  ): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const message = context.getMessage() as Message;
    const parsed = betEventSchema.safeParse(data);
    if (!parsed.success) {
      this.logger.error({ pattern, result: 'rejected', reason: parsed.error.message });
      this.reply(() => channel.nack(message, false, false));
      return;
    }
    const { betId, playerId } = parsed.data;
    try {
      const result = await withRetry(
        () => apply(parsed.data),
        this.retryDelays,
        (attempt, error) =>
          this.logger.warn({ pattern, betId, result: 'retry', attempt, reason: String(error) }),
      );
      this.reply(() => channel.ack(message));
      this.logger.log({ pattern, betId, playerId, result });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error({ pattern, betId, playerId, result: 'rejected', reason });
      this.reply(() => channel.nack(message, false, false));
    }
  }

  // If the channel is already closed the broker redelivers the message, which is safe.
  private reply(send: () => void): void {
    try {
      send();
    } catch (error) {
      this.logger.warn(`Cannot ack/nack on a closed channel: ${String(error)}`);
    }
  }
}
