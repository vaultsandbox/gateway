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
}
