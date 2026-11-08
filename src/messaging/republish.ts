import type { ConfirmChannel, Message, MessagePropertyHeaders, Options } from 'amqplib';

import { BROKER_HEADERS } from './messaging.constants';

/**
 * Publishes a copy of a received message and resolves once the broker confirms it.
 * Content and identifying properties are kept; `headers` are added on top.
 * Rejects if the channel is closed or the broker refuses the message.
 */
export function republish(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  message: Message,
  headers: MessagePropertyHeaders,
): Promise<void> {
  // amqplib types received properties as `any`; they are the same AMQP fields.
  const properties = message.properties as Options.Publish;
  const kept = Object.fromEntries(
    Object.entries((properties.headers ?? {}) as MessagePropertyHeaders).filter(
      ([name]) => !BROKER_HEADERS.includes(name),
    ),
  );
  const options: Options.Publish = {
    persistent: true,
    contentType: properties.contentType,
    contentEncoding: properties.contentEncoding,
    correlationId: properties.correlationId,
    messageId: properties.messageId,
    timestamp: properties.timestamp,
    type: properties.type,
    appId: properties.appId,
    headers: { ...kept, ...headers },
  };

  return new Promise((resolve, reject) => {
    channel.publish(exchange, routingKey, message.content, options, (error: unknown) =>
      error
        ? reject(
            error instanceof Error ? error : new Error('Publish not confirmed', { cause: error }),
          )
        : resolve(),
    );
  });
}
