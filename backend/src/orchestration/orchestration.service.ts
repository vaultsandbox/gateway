/* v8 ignore start - TODO - Not being used yet */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { LeadershipAcquireResponse, LeadershipReleaseResponse, OrchestrationConfig } from './interfaces';

/**
 * Service responsible for distributed coordination and leadership election
 * in multi-node gateway clusters.
 *
 * Provides distributed lock management via backend Redis API to prevent
 * split-brain scenarios during certificate renewal operations. Supports
 * both single-node (orchestration disabled) and multi-node deployments.
 *
 * @remarks
 * - When orchestration is disabled, assumes single-node deployment and grants leadership automatically
 * - Leadership locks are TTL-based and managed by the backend Redis API
 * - All nodes must use the same cluster name for proper coordination
 *
 * @see {@link OrchestrationConfig} for configuration options
 */
@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  /**
   * Orchestration configuration loaded from environment variables.
   */
  private readonly config: OrchestrationConfig;

  /**
   * Current leadership lock ID if this node holds leadership, null otherwise.
   */
  private currentLockId: string | null = null;

  /**
   * Initializes the orchestration service with configuration.
   *
   * @param configService - NestJS config service for loading environment variables
   * @param httpService - Axios-based HTTP client for backend API communication
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    const config = this.configService.get<OrchestrationConfig>('vsb.orchestration');
    this.config = config ?? {
      enabled: false,
      clusterName: 'default',
      nodeId: 'node-unknown',
      peers: [],
      backend: { url: '', apiKey: '', timeout: 10000 },
      leadership: { ttl: 300 },
    };
  }

  /**
   * Attempts to acquire distributed leadership lock for certificate renewal operations.
   *
   * Communicates with the backend Redis API to obtain an exclusive, TTL-based lock
   * for the cluster. Only one node in the cluster can hold leadership at a time.
   *
   * @returns Promise resolving to `true` if leadership was acquired, `false` otherwise
   *
   * @remarks
   * - When orchestration is disabled, always returns `true` (single-node mode)
   * - If backend URL is not configured, returns `false`
   * - On success, stores the lock ID in `currentLockId` for later release
   * - Lock expires automatically after TTL (default: 300 seconds)
   * - HTTP errors are logged but do not throw exceptions
   *
   * @see {@link releaseLeadership} to explicitly release the lock
   * @see {@link LeadershipAcquireResponse} for backend API response format
   */
  async acquireLeadership(): Promise<boolean> {
    if (!this.config.enabled) {
      this.logger.log('Cluster coordination disabled, assuming leadership');
      return true;
    }

    if (!this.config.backend.url) {
      this.logger.warn('Orchestration backend URL not configured; cannot acquire leadership');
      return false;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<LeadershipAcquireResponse>(
          `${this.config.backend.url}/gateway/leadership/acquire`,
          {
            clusterName: this.config.clusterName,
            nodeId: this.config.nodeId,
            purpose: 'certificate-renewal',
            ttl: this.config.leadership.ttl,
          },
          {
            headers: {
              'X-API-Key': this.config.backend.apiKey,
              'Content-Type': 'application/json',
            },
            timeout: this.config.backend.timeout,
          },
        ),
      );

      if (response.data.isLeader) {
        this.currentLockId = response.data.lockId ?? null;
        this.logger.log('Leadership acquired for certificate renewal', {
          lockId: this.currentLockId,
          expiresAt: response.data.expiresAt,
        });
        return true;
      }

      this.logger.debug('Another node currently holds leadership', {
        currentLeader: response.data.currentLeader,
        lockExpiresAt: response.data.lockExpiresAt,
      });
      return false;
    } catch (error) {
      this.logHttpError('Failed to acquire leadership from backend', error);
      return false;
    }
  }

  /**
   * Explicitly releases the leadership lock held by this node.
   *
   * Communicates with the backend Redis API to release the distributed lock,
   * allowing other nodes to acquire leadership.
   *
   * @returns Promise that resolves when release is complete (regardless of success)
   *
   * @remarks
   * - No-op if orchestration is disabled or no lock is currently held
   * - Always clears `currentLockId` in finally block to prevent stale state
   * - If backend URL is not configured, only clears local state
   * - HTTP errors are logged but do not throw exceptions
   * - Should be called when certificate renewal is complete or fails
   *
   * @see {@link acquireLeadership} to acquire the lock initially
   * @see {@link LeadershipReleaseResponse} for backend API response format
   */
  async releaseLeadership(): Promise<void> {
    if (!this.config.enabled || !this.currentLockId) {
      return;
    }

    if (!this.config.backend.url) {
      this.logger.warn('Orchestration backend URL not configured; skipping leadership release');
      this.currentLockId = null;
      return;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<LeadershipReleaseResponse>(
          `${this.config.backend.url}/gateway/leadership/release`,
          {
            clusterName: this.config.clusterName,
            nodeId: this.config.nodeId,
            lockId: this.currentLockId,
          },
          {
            headers: {
              'X-API-Key': this.config.backend.apiKey,
              'Content-Type': 'application/json',
            },
            timeout: this.config.backend.timeout,
          },
        ),
      );

      if (response.data.released) {
        this.logger.log('Leadership released successfully', {
          lockId: this.currentLockId,
          releasedAt: response.data.releasedAt,
        });
      } else {
        this.logger.warn('Leadership release response did not confirm release', response.data);
      }
    } catch (error) {
      this.logHttpError('Failed to release leadership', error);
    } finally {
      this.currentLockId = null;
    }
  }

  /**
   * Returns the list of peer node URLs in the cluster.
   *
   * @returns Array of peer URLs (e.g., `['https://node-2:9999', 'https://node-3:9999']`)
   *
   * @remarks
   * Used by certificate synchronization to distribute certificates to follower nodes.
   * Empty array indicates single-node deployment.
   */
  getPeers(): string[] {
    return this.config.peers;
  }

  /**
   * Returns the unique identifier for this node.
   *
   * @returns Node ID string (e.g., `'node-1'`, `'node-unknown'`)
   *
   * @remarks
   * Used for leadership acquisition and logging to identify which node holds the lock.
   */
  getNodeId(): string {
    return this.config.nodeId;
  }

  /**
   * Returns the cluster name this node belongs to.
   *
   * @returns Cluster name string (e.g., `'production-smtp'`, `'default'`)
   *
   * @remarks
   * Enables multi-tenant coordination when multiple clusters share the same backend API.
   * Locks are scoped per cluster name.
   */
  getClusterName(): string {
    return this.config.clusterName;
  }

  /**
   * Checks if distributed orchestration is enabled for this node.
   *
   * @returns `true` if clustering is enabled, `false` for single-node mode
   *
   * @remarks
   * When `false`, leadership is always granted and peer synchronization is skipped.
   */
  isClusteringEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Logs an HTTP error from the backend API with structured details.
   *
   * @param message - The high-level error message
   * @param error - The unknown error object, typically from a catch block
   *
   * @remarks
   * - If the error is an `AxiosError`, logs status and response data
   * - Otherwise, logs the error message and stack if available
   * - Falls back to JSON stringification for unknown error types
   */
  private logHttpError(message: string, error: unknown): void {
    if (error instanceof AxiosError) {
      const details: string = JSON.stringify({
        status: error.response?.status,
        data: error.response?.data as unknown,
      });
      this.logger.error(`${message}: ${error.message} ${details}`, error.stack);
      return;
    }

    if (error && typeof error === 'object' && 'message' in error) {
      const err = error as Error;
      this.logger.error(message, err.stack ?? err.message);
      return;
    }

    this.logger.error(message, JSON.stringify(error));
  }
}
/* v8 ignore stop */
