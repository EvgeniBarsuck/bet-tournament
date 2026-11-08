import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';

import { ID_PATTERN } from './formats';

export const PLAYER_ID_HEADER = 'x-player-id';

/**
 * Injects the validated X-Player-Id header; responds 400 if it is missing or malformed.
 * The header identifies the player; it is not authentication.
 */
export const PlayerId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const { headers } = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
  const value = headers[PLAYER_ID_HEADER];

  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new BadRequestException('X-Player-Id header is required: 1-128 chars [A-Za-z0-9_.:-]');
  }

  return value;
});
