/**
 * Application-wide constants to avoid magic numbers scattered across the codebase.
 */

/** Default duration for toast notifications in milliseconds. */
export const TOAST_DURATION_MS = 3000;

/** Interval for auto-refreshing metrics dialog in milliseconds. */
export const AUTO_REFRESH_INTERVAL_MS = 5000;

/** Timeout for fetch requests (e.g., link validation) in milliseconds. */
export const FETCH_TIMEOUT_MS = 10000;

/** Time conversion constants in seconds. */
export const TIME = {
  SECONDS_PER_MINUTE: 60,
  SECONDS_PER_HOUR: 3600,
  SECONDS_PER_DAY: 86400,
} as const;
