import { z } from 'zod';

import { CURRENCY_PATTERN, DECIMAL_PATTERN, NON_ZERO_DIGIT } from '../common/formats';
import {
  CONFIG_DEFAULTS,
  HTTP_DB_CONNECTIONS,
  LOG_FORMAT,
  type LogFormat,
  MAX_DB_POOL_SIZE,
} from './config.constants';

export { CONFIG } from './config.constants';

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    RABBITMQ_QUEUE: z.string().min(1).default(CONFIG_DEFAULTS.queue),
    PORT: z.coerce.number().int().positive().default(CONFIG_DEFAULTS.port),
    PREFETCH: z.coerce.number().int().positive().default(CONFIG_DEFAULTS.prefetch),
    /** Defaults to PREFETCH + HTTP_DB_CONNECTIONS. */
    DB_POOL_SIZE: z.coerce.number().int().positive().optional(),
    USD_RATES: z.string().default(CONFIG_DEFAULTS.usdRates),
    LOG_FORMAT: z.enum(LOG_FORMAT).default(CONFIG_DEFAULTS.logFormat),
  })
  .transform(({ DB_POOL_SIZE, ...e }) => ({
    ...e,
    DB_POOL_SIZE: DB_POOL_SIZE ?? e.PREFETCH + HTTP_DB_CONNECTIONS,
  }))
  // Every in-flight message holds one connection; otherwise messages wait for the pool.
  .refine((e) => e.PREFETCH <= e.DB_POOL_SIZE - HTTP_DB_CONNECTIONS, {
    path: ['PREFETCH'],
    message: `PREFETCH must not exceed DB_POOL_SIZE - ${HTTP_DB_CONNECTIONS}`,
  })
  .refine((e) => e.DB_POOL_SIZE <= MAX_DB_POOL_SIZE, {
    path: ['DB_POOL_SIZE'],
    message: `DB_POOL_SIZE (or PREFETCH + ${HTTP_DB_CONNECTIONS}) must not exceed ${MAX_DB_POOL_SIZE}`,
  });

// USD per one unit of currency: positive decimal string, never a JS number.
const rates = z.record(
  z.string().regex(CURRENCY_PATTERN),
  z
    .string()
    .regex(DECIMAL_PATTERN)
    .refine((rate) => NON_ZERO_DIGIT.test(rate), 'rate must be positive'),
);

export interface Config {
  readonly databaseUrl: string;
  readonly rabbitmqUrl: string;
  readonly queue: string;
  readonly port: number;
  /** Max unacknowledged messages, i.e. max concurrently processed events. */
  readonly prefetch: number;
  readonly dbPoolSize: number;
  readonly rates: ReadonlyMap<string, string>;
  readonly logFormat: LogFormat;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const e = env.parse(source);
  let raw: unknown;

  try {
    raw = JSON.parse(e.USD_RATES);
  } catch {
    throw new Error('USD_RATES must be a JSON object, e.g. {"USD":"1","EUR":"1.10"}');
  }

  return {
    databaseUrl: e.DATABASE_URL,
    rabbitmqUrl: e.RABBITMQ_URL,
    queue: e.RABBITMQ_QUEUE,
    port: e.PORT,
    prefetch: e.PREFETCH,
    dbPoolSize: e.DB_POOL_SIZE,
    rates: new Map(Object.entries(rates.parse(raw))),
    logFormat: e.LOG_FORMAT,
  };
}
