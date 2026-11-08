import { DEFAULT_QUEUE } from '../messaging/messaging.constants';

export const CONFIG = Symbol('CONFIG');

export const LOG_FORMAT = Object.freeze({
  /** One JSON object per line: for containers and log collectors. */
  JSON: 'json',
  /** Colored multi-line output: for local development. */
  TEXT: 'text',
} as const);

export type LogFormat = (typeof LOG_FORMAT)[keyof typeof LOG_FORMAT];

export const CONFIG_DEFAULTS = Object.freeze({
  queue: DEFAULT_QUEUE,
  port: 3000,
  prefetch: 10,
  usdRates: '{"USD":"1"}',
  logFormat: LOG_FORMAT.JSON,
});

/** Pool connections kept free for HTTP reads; the rest serve in-flight messages. */
export const HTTP_DB_CONNECTIONS = 2;

/** Keeps one app instance well below PostgreSQL's default max_connections (100). */
export const MAX_DB_POOL_SIZE = 50;

/** Listen on all interfaces: required inside a container. */
export const HTTP_HOST = '0.0.0.0';
