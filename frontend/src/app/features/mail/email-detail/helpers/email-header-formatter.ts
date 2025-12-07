export interface HeaderEntry {
  key: string;
  value: string;
}

export class EmailHeaderFormatter {
  /**
   * Normalizes arbitrary header values into a list of display-ready key/value pairs.
   */
  static buildHeadersList(headers: Record<string, unknown> | null | undefined): HeaderEntry[] {
    if (!headers) {
      return [];
    }

    return Object.entries(headers).map(([key, value]) => ({
      key,
      value: EmailHeaderFormatter.formatHeaderValue(value),
    }));
  }

  /**
   * Formats a header value that may be a string, array, or parsed object into a human-readable string.
   */
  static formatHeaderValue(value: unknown): string {
    if (value == null) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => EmailHeaderFormatter.formatHeaderValue(item))
        .filter((text) => Boolean(text.trim()))
        .join(', ');
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;

      const textLikeFields: ('text' | 'line')[] = ['text', 'line'];
      for (const field of textLikeFields) {
        const candidate = obj[field];
        if (typeof candidate === 'string' && candidate.trim().length) {
          return candidate;
        }
      }

      const rawValue = obj['value'];
      if (typeof rawValue === 'string' && rawValue.trim()) {
        return rawValue;
      }

      if (Array.isArray(rawValue)) {
        const formattedAddresses = rawValue
          .map((entry) => EmailHeaderFormatter.formatHeaderAddress(entry))
          .filter(Boolean)
          .join(', ');
        if (formattedAddresses) {
          return formattedAddresses;
        }
      }

      const params = obj['params'];
      // Preserve semi-colon separated params to match how headers are typically emitted.
      if (params && typeof params === 'object' && !Array.isArray(params)) {
        const formattedParams = Object.entries(params as Record<string, unknown>)
          .map(([paramKey, paramValue]) => `${paramKey}=${EmailHeaderFormatter.formatHeaderValue(paramValue)}`)
          .join('; ');
        if (formattedParams.trim()) {
          return formattedParams;
        }
      }

      try {
        const serialized = JSON.stringify(value);
        if (serialized && serialized !== '{}') {
          return serialized;
        }
      } catch {
        // Fall through to string coercion.
      }
    }

    return String(value);
  }

  /**
   * Formats a single address entry, handling named addresses and nested groups.
   */
  static formatHeaderAddress(value: unknown): string {
    if (!value || typeof value !== 'object') {
      return typeof value === 'string' ? value : '';
    }

    const address = value as {
      name?: string;
      address?: string;
      group?: Record<string, unknown>[];
    };

    if (address.group?.length) {
      const groupMembers = address.group
        .map((member) => EmailHeaderFormatter.formatHeaderAddress(member))
        .filter(Boolean)
        .join(', ');

      if (address.name) {
        return `${address.name}: ${groupMembers}`;
      }

      return groupMembers;
    }

    if (address.name && address.address) {
      return `${address.name} <${address.address}>`;
    }

    return address.address || address.name || '';
  }
}
