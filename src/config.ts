import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

const CURRENCY = /^[A-Z]{3}$/;
// USD per one unit of currency: positive decimal string, never a JS number.
const RATE = /^\d{1,12}(\.\d{1,8})?$/;

const env = z.object({
  DATABASE_URL: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_QUEUE: z.string().min(1).default('bet.events'),
  PORT: z.coerce.number().int().positive().default(3000),
  PREFETCH: z.coerce.number().int().positive().max(1000).default(10),
  USD_RATES: z.string().default('{"USD":"1"}'),
});

const rates = z.record(
  z.string().regex(CURRENCY),
  z
    .string()
    .regex(RATE)
    .refine((rate) => /[1-9]/.test(rate), 'rate must be positive'),
);

export interface Config {
  readonly databaseUrl: string;
  readonly rabbitmqUrl: string;
  readonly queue: string;
  readonly port: number;
  /** Max unacknowledged messages, i.e. max concurrently processed events. */
  readonly prefetch: number;
  readonly rates: ReadonlyMap<string, string>;
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
    rates: new Map(Object.entries(rates.parse(raw))),
  };
}
