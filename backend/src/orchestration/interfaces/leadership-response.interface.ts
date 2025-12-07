export interface LeadershipAcquireResponse {
  isLeader: boolean;
  lockId?: string;
  acquiredAt?: string;
  expiresAt?: string;
  ttl?: number;
  currentLeader?: string;
  lockExpiresAt?: string;
}

export interface LeadershipReleaseResponse {
  released: boolean;
  releasedAt?: string;
  error?: string;
}
