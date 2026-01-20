import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ServerInfo,
  CreateInboxResponse,
  EmailListItemResponse,
  EmailDetailResponse,
  RawEmailResponse,
} from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class VaultSandboxApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  /**
   * GET /api/check-key
   * API key validation endpoint
   * Requires X-API-Key header
   */
  checkKey(): Observable<{ ok: boolean }> {
    return this.http.get<{ ok: boolean }>(`${this.baseUrl}/check-key`);
  }

  /**
   * GET /api/server-info
   * Public endpoint - returns server cryptographic information
   */
  getServerInfo(): Observable<ServerInfo> {
    return this.http.get<ServerInfo>(`${this.baseUrl}/server-info`);
  }

  /**
   * POST /api/inboxes
   * Create a new inbox
   * Requires X-API-Key header
   * @param options.clientKemPk - Client's public KEM key (base64url encoded). Required when encryption is enabled.
   * @param options.ttl - Optional TTL in seconds
   * @param options.emailAddress - Optional: domain only (e.g., "example.com") or full email (e.g., "alias@example.com")
   * @param options.encryption - Optional: 'encrypted' | 'plain'. Omit to use server default.
   * @param options.emailAuth - Optional: true/false to enable/disable email auth checks. Omit to use server default.
   * @param options.spamAnalysis - Optional: true/false to enable/disable spam analysis. Omit to use server default.
   */
  createInbox(options: {
    clientKemPk?: string;
    ttl?: number;
    emailAddress?: string;
    encryption?: 'encrypted' | 'plain';
    emailAuth?: boolean;
    spamAnalysis?: boolean;
  }): Observable<CreateInboxResponse> {
    const body: {
      clientKemPk?: string;
      ttl?: number;
      emailAddress?: string;
      encryption?: 'encrypted' | 'plain';
      emailAuth?: boolean;
      spamAnalysis?: boolean;
    } = {};
    if (options.clientKemPk) body.clientKemPk = options.clientKemPk;
    if (options.ttl !== undefined) body.ttl = options.ttl;
    if (options.emailAddress) body.emailAddress = options.emailAddress;
    if (options.encryption) body.encryption = options.encryption;
    if (options.emailAuth !== undefined) body.emailAuth = options.emailAuth;
    if (options.spamAnalysis !== undefined) body.spamAnalysis = options.spamAnalysis;

    return this.http.post<CreateInboxResponse>(`${this.baseUrl}/inboxes`, body);
  }

  /**
   * GET /api/inboxes/:emailAddress/emails
   * List all emails for an inbox (encrypted metadata only)
   * Requires X-API-Key header
   */
  listEmails(emailAddress: string): Observable<EmailListItemResponse[]> {
    return this.http.get<EmailListItemResponse[]>(`${this.baseUrl}/inboxes/${emailAddress}/emails`);
  }

  /**
   * GET /api/inboxes/:emailAddress/sync
   * Get a hash of the email list for quick synchronization checks
   * Requires X-API-Key header
   */
  getInboxSyncStatus(emailAddress: string): Observable<{ emailsHash: string; emailCount: number }> {
    return this.http.get<{ emailsHash: string; emailCount: number }>(`${this.baseUrl}/inboxes/${emailAddress}/sync`);
  }

  /**
   * GET /api/inboxes/:emailAddress/emails/:emailId
   * Get full encrypted email (metadata + parsed content)
   * Requires X-API-Key header
   */
  getEmail(emailAddress: string, emailId: string): Observable<EmailDetailResponse> {
    return this.http.get<EmailDetailResponse>(`${this.baseUrl}/inboxes/${emailAddress}/emails/${emailId}`);
  }

  /**
   * GET /api/inboxes/:emailAddress/emails/:emailId/raw
   * Get encrypted raw email source
   * Requires X-API-Key header
   */
  getRawEmail(emailAddress: string, emailId: string): Observable<RawEmailResponse> {
    return this.http.get<RawEmailResponse>(`${this.baseUrl}/inboxes/${emailAddress}/emails/${emailId}/raw`);
  }

  /**
   * DELETE /api/inboxes/:emailAddress
   * Delete an inbox and all associated emails
   * Requires X-API-Key header
   */
  deleteInbox(emailAddress: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/inboxes/${emailAddress}`);
  }

  /**
   * PATCH /api/inboxes/:emailAddress/emails/:emailId/read
   * Mark an email as read
   * Requires X-API-Key header
   */
  markEmailAsRead(emailAddress: string, emailId: string): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/inboxes/${emailAddress}/emails/${emailId}/read`, {});
  }

  /**
   * DELETE /api/inboxes/:emailAddress/emails/:emailId
   * Delete a single email from an inbox
   * Requires X-API-Key header
   */
  deleteEmail(emailAddress: string, emailId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/inboxes/${emailAddress}/emails/${emailId}`);
  }

  /**
   * DELETE /api/inboxes
   * Clear all inboxes (testing/maintenance)
   * Requires X-API-Key header
   */
  clearAllInboxes(): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/inboxes`);
  }

  /**
   * GET /api/proxy/check
   * Check if an external URL is reachable (bypasses CORS)
   * Requires X-API-Key header
   * @param url - The URL to check
   */
  checkLink(url: string): Observable<{ valid: boolean; status?: number; contentType?: string }> {
    return this.http.get<{ valid: boolean; status?: number; contentType?: string }>(`${this.baseUrl}/proxy/check`, {
      params: { url },
    });
  }

  /**
   * GET /api/proxy
   * Fetch an external image through the proxy (bypasses CORS)
   * Requires X-API-Key header
   * @param url - The URL of the image to fetch
   */
  getProxyImage(url: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/proxy`, {
      params: { url },
      responseType: 'blob',
    });
  }
}
