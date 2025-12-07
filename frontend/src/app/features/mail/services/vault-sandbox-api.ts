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
   * @param clientKemPk - Client's public KEM key (base64url encoded)
   * @param ttl - Optional TTL in seconds
   * @param emailAddress - Optional: domain only (e.g., "example.com") or full email (e.g., "alias@example.com")
   */
  createInbox(clientKemPk: string, ttl?: number, emailAddress?: string): Observable<CreateInboxResponse> {
    const body: {
      clientKemPk: string;
      ttl?: number;
      emailAddress?: string;
    } = { clientKemPk };
    if (ttl !== undefined) body.ttl = ttl;
    if (emailAddress) body.emailAddress = emailAddress;

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
}
