/**
 * Rspamd /checkv2 API response structure
 * @see https://rspamd.com/doc/architecture/protocol.html
 */
export interface RspamdCheckResponse {
  /** Overall spam score (positive = more spammy) */
  score: number;

  /** Required score threshold for spam action */
  required_score: number;

  /** Recommended action: 'no action' | 'greylist' | 'add header' | 'rewrite subject' | 'soft reject' | 'reject' */
  action: string;

  /** Whether the message is spam based on action */
  is_spam?: boolean;

  /** Whether the message is skipped (too large, etc.) */
  is_skipped?: boolean;

  /** Triggered spam rules/symbols */
  symbols: Record<string, RspamdSymbol>;

  /** Message ID from Rspamd */
  message_id?: string;

  /** Processing time in milliseconds */
  time_real?: number;

  /** URLs found in message */
  urls?: string[];

  /** Emails found in message */
  emails?: string[];

  /** Subject of the message */
  subject?: string;
}

export interface RspamdSymbol {
  /** Symbol name (rule identifier) */
  name: string;

  /** Score contribution from this symbol */
  score: number;

  /** Metric group this symbol belongs to */
  metric_score?: number;

  /** Human-readable description */
  description?: string;

  /** Additional options/data from the symbol */
  options?: string[];
}
