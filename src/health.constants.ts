/** `status` field of the /health responses. */
export const HEALTH_STATUS = Object.freeze({
  OK: 'ok',
  UNAVAILABLE: 'unavailable',
} as const);

/** Body of a successful liveness or readiness check. */
export const HEALTHY = Object.freeze({ status: HEALTH_STATUS.OK });

export type Healthy = typeof HEALTHY;
