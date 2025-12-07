import { TIME } from '../constants/app.constants';

/**
 * Time conversion and formatting utilities.
 */

/**
 * Converts seconds to hours.
 */
export function secondsToHours(seconds: number): number {
  return Math.round(seconds / TIME.SECONDS_PER_HOUR);
}

/**
 * Converts hours to seconds.
 */
export function hoursToSeconds(hours: number): number {
  return hours * TIME.SECONDS_PER_HOUR;
}

/**
 * Converts seconds to minutes.
 */
export function secondsToMinutes(seconds: number): number {
  return Math.round(seconds / TIME.SECONDS_PER_MINUTE);
}

/**
 * Converts minutes to seconds.
 */
export function minutesToSeconds(minutes: number): number {
  return minutes * TIME.SECONDS_PER_MINUTE;
}

/**
 * Converts seconds to days.
 */
export function secondsToDays(seconds: number): number {
  return Math.round(seconds / TIME.SECONDS_PER_DAY);
}

/**
 * Converts days to seconds.
 */
export function daysToSeconds(days: number): number {
  return days * TIME.SECONDS_PER_DAY;
}

export type TtlUnit = 'minutes' | 'hours' | 'days';

/**
 * Converts a value with unit to seconds.
 */
export function toSeconds(value: number, unit: TtlUnit): number {
  switch (unit) {
    case 'minutes':
      return minutesToSeconds(value);
    case 'hours':
      return hoursToSeconds(value);
    case 'days':
      return daysToSeconds(value);
    default:
      return hoursToSeconds(value);
  }
}

/**
 * Converts seconds to a value in the specified unit.
 */
export function fromSeconds(seconds: number, unit: TtlUnit): number {
  switch (unit) {
    case 'minutes':
      return secondsToMinutes(seconds);
    case 'hours':
      return secondsToHours(seconds);
    case 'days':
      return secondsToDays(seconds);
    default:
      return secondsToHours(seconds);
  }
}

/**
 * Formats uptime in a compact `Xd Yh Zm Ss` string, omitting zero-value parts.
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / TIME.SECONDS_PER_DAY);
  const hours = Math.floor((seconds % TIME.SECONDS_PER_DAY) / TIME.SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % TIME.SECONDS_PER_HOUR) / TIME.SECONDS_PER_MINUTE);
  const secs = Math.floor(seconds % TIME.SECONDS_PER_MINUTE);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Formats seconds into a compact human-readable duration (e.g., "5m", "2h", "3d").
 */
export function formatDuration(seconds: number): string {
  if (seconds < TIME.SECONDS_PER_MINUTE) return `${seconds}s`;
  if (seconds < TIME.SECONDS_PER_HOUR) return `${Math.floor(seconds / TIME.SECONDS_PER_MINUTE)}m`;
  if (seconds < TIME.SECONDS_PER_DAY) return `${Math.floor(seconds / TIME.SECONDS_PER_HOUR)}h`;
  return `${Math.floor(seconds / TIME.SECONDS_PER_DAY)}d`;
}

/**
 * Formats milliseconds into a compact human-readable duration.
 */
export function formatDurationMs(ms: number): string {
  return formatDuration(Math.floor(ms / 1000));
}
