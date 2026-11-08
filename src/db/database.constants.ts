export const DB_POOL_OPTIONS = Object.freeze({
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  lock_timeout: 5_000,
});

/** SQLSTATE and socket codes that may succeed when the whole transaction is retried. */
export const TRANSIENT_DB_CODES: ReadonlySet<string> = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available (lock_timeout)
  '57014', // query_canceled (statement_timeout)
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // DNS: in Docker and Kubernetes a stopped database host stops resolving.
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** SQLSTATE class 08: connection exception. */
export const CONNECTION_EXCEPTION_CLASS = '08';

/** pg reports a dropped connection / pool checkout timeout without a code. */
export const CONNECTION_LOST_MESSAGE =
  /^Connection terminated|timeout exceeded when trying to connect/;

export const MIGRATIONS_DIRECTORY = 'migrations';
export const MIGRATION_FILE_EXTENSION = '.sql';
