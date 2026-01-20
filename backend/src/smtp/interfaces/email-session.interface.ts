export interface SpfResult {
  status: 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'skipped';
  domain?: string;
  ip?: string;
  info?: string;
}

export interface DkimResult {
  status: 'pass' | 'fail' | 'none' | 'skipped';
  domain?: string;
  selector?: string;
  info?: string;
}

export interface DmarcResult {
  status: 'pass' | 'fail' | 'none' | 'skipped';
  policy?: 'none' | 'quarantine' | 'reject';
  aligned?: boolean;
  domain?: string;
  info?: string;
}

export interface ReverseDnsResult {
  status: 'pass' | 'fail' | 'none' | 'skipped';
  ip?: string;
  hostname?: string;
  info?: string;
}

export interface SpamSymbol {
  /** Rule/symbol name */
  name: string;

  /** Score contribution */
  score: number;

  /** Human-readable description */
  description?: string;

  /** Additional context */
  options?: string[];
}

export interface SpamAnalysisResult {
  /** Analysis status */
  status: 'analyzed' | 'skipped' | 'error';

  /** Overall spam score (positive = more spammy) */
  score?: number;

  /** Required score threshold */
  requiredScore?: number;

  /** Recommended action from Rspamd */
  action?: 'no action' | 'greylist' | 'add header' | 'rewrite subject' | 'soft reject' | 'reject';

  /** Whether classified as spam */
  isSpam?: boolean;

  /** Triggered rules with scores */
  symbols?: SpamSymbol[];

  /** Processing time in milliseconds */
  processingTimeMs?: number;

  /** Error or skip reason */
  info?: string;
}

export interface ReceivedEmail {
  from?: string;
  to: string[];
  messageId?: string;
  rawData: Buffer;
  size: number;
  headers: Record<string, string>;
  spfResult?: SpfResult;
  dkimResults?: DkimResult[];
  dmarcResult?: DmarcResult;
  reverseDnsResult?: ReverseDnsResult;
  spamAnalysis?: SpamAnalysisResult;
}
