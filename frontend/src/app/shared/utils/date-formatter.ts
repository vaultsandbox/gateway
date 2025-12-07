export type DateFormatStyle = 'detailed' | 'relative' | 'friendly';
export type TimeFormat = '12h' | '24h';

/**
 * Centralized helpers to keep email date formatting consistent across the UI.
 */
export class DateFormatter {
  /**
   * Gets the user's time format preference from localStorage.
   * @returns The time format preference ('12h' or '24h'), defaulting to '24h'.
   */
  private static getTimeFormat(): TimeFormat {
    try {
      const stored = localStorage.getItem('vaultsandbox_settings');
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.timeFormat === '12h' || settings.timeFormat === '24h') {
          return settings.timeFormat;
        }
      }
    } catch {
      // Ignore parse errors
    }
    return '24h';
  }

  /**
   * Converts an ISO date string into either a detailed timestamp or a relative label.
   * @param dateStr ISO string or any value understood by `Date`.
   * @param style Output style, defaults to `relative`.
   * @returns Formatted display string or an empty string when the input is invalid.
   */
  static format(dateStr: string, style: DateFormatStyle = 'relative'): string {
    if (!dateStr) {
      return '';
    }

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return '';
    }

    if (style === 'detailed') {
      return this.formatDetailed(date);
    }

    if (style === 'friendly') {
      return this.formatFriendly(date);
    }

    return this.formatRelative(date);
  }

  /**
   * Formats the provided date as a detailed timestamp (weekday, month, etc.).
   * @param date Parsed date object.
   * @returns Formatted timestamp string.
   */
  private static formatDetailed(date: Date): string {
    const timeFormat = this.getTimeFormat();
    return date.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: timeFormat === '12h',
    });
  }

  /**
   * Formats as time when on the same day, otherwise falls back to a detailed timestamp.
   * @param date Parsed date object.
   * @returns Time string for same-day emails or detailed string for older emails.
   */
  private static formatFriendly(date: Date): string {
    const now = new Date();
    const isSameDay =
      now.getFullYear() === date.getFullYear() &&
      now.getMonth() === date.getMonth() &&
      now.getDate() === date.getDate();

    if (isSameDay) {
      const timeFormat = this.getTimeFormat();
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: timeFormat === '12h',
      });
    }

    return this.formatDetailed(date);
  }

  /**
   * Formats a date string as a time-only value honoring the user's 12h/24h preference.
   * @param dateStr ISO string or any value understood by `Date`.
   * @returns Time string or an empty string when the input is invalid.
   */
  static formatTimeOnly(dateStr: string): string {
    if (!dateStr) {
      return '';
    }

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return '';
    }

    const timeFormat = this.getTimeFormat();
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: timeFormat === '12h',
    });
  }

  /**
   * Formats the provided date relative to "now" (e.g., `3 minutes ago`).
   * @param date Parsed date object.
   * @returns Human-readable relative time string.
   */
  private static formatRelative(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'just now';
    }
    if (diffMins < 60) {
      return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    }
    if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }

    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}
