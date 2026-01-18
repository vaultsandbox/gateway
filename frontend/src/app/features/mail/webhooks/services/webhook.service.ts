import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookResponse,
  WebhookListResponse,
  TestWebhookResponse,
  RotateSecretResponse,
  WebhookScope,
  WebhookTemplatesResponse,
} from '../interfaces/webhook.interfaces';

@Injectable({ providedIn: 'root' })
export class WebhookService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  // ==================== Global Webhooks ====================

  listGlobalWebhooks(): Observable<WebhookListResponse> {
    return this.http.get<WebhookListResponse>(`${this.baseUrl}/webhooks`);
  }

  getGlobalWebhook(id: string): Observable<WebhookResponse> {
    return this.http.get<WebhookResponse>(`${this.baseUrl}/webhooks/${id}`);
  }

  createGlobalWebhook(dto: CreateWebhookDto): Observable<WebhookResponse> {
    return this.http.post<WebhookResponse>(`${this.baseUrl}/webhooks`, dto);
  }

  updateGlobalWebhook(id: string, dto: UpdateWebhookDto): Observable<WebhookResponse> {
    return this.http.patch<WebhookResponse>(`${this.baseUrl}/webhooks/${id}`, dto);
  }

  deleteGlobalWebhook(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/webhooks/${id}`);
  }

  testGlobalWebhook(id: string): Observable<TestWebhookResponse> {
    return this.http.post<TestWebhookResponse>(`${this.baseUrl}/webhooks/${id}/test`, {});
  }

  rotateGlobalWebhookSecret(id: string): Observable<RotateSecretResponse> {
    return this.http.post<RotateSecretResponse>(`${this.baseUrl}/webhooks/${id}/rotate-secret`, {});
  }

  // ==================== Templates ====================

  getTemplates(): Observable<WebhookTemplatesResponse> {
    return this.http.get<WebhookTemplatesResponse>(`${this.baseUrl}/webhooks/templates`);
  }

  // ==================== Inbox Webhooks ====================

  listInboxWebhooks(email: string): Observable<WebhookListResponse> {
    return this.http.get<WebhookListResponse>(`${this.baseUrl}/inboxes/${encodeURIComponent(email)}/webhooks`);
  }

  getInboxWebhook(email: string, id: string): Observable<WebhookResponse> {
    return this.http.get<WebhookResponse>(`${this.baseUrl}/inboxes/${encodeURIComponent(email)}/webhooks/${id}`);
  }

  createInboxWebhook(email: string, dto: CreateWebhookDto): Observable<WebhookResponse> {
    return this.http.post<WebhookResponse>(`${this.baseUrl}/inboxes/${encodeURIComponent(email)}/webhooks`, dto);
  }

  updateInboxWebhook(email: string, id: string, dto: UpdateWebhookDto): Observable<WebhookResponse> {
    return this.http.patch<WebhookResponse>(`${this.baseUrl}/inboxes/${encodeURIComponent(email)}/webhooks/${id}`, dto);
  }

  deleteInboxWebhook(email: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/inboxes/${encodeURIComponent(email)}/webhooks/${id}`);
  }

  testInboxWebhook(email: string, id: string): Observable<TestWebhookResponse> {
    return this.http.post<TestWebhookResponse>(
      `${this.baseUrl}/inboxes/${encodeURIComponent(email)}/webhooks/${id}/test`,
      {},
    );
  }

  rotateInboxWebhookSecret(email: string, id: string): Observable<RotateSecretResponse> {
    return this.http.post<RotateSecretResponse>(
      `${this.baseUrl}/inboxes/${encodeURIComponent(email)}/webhooks/${id}/rotate-secret`,
      {},
    );
  }

  // ==================== Unified Scope-Aware Methods ====================

  list(scope: WebhookScope): Observable<WebhookListResponse> {
    return scope.type === 'global' ? this.listGlobalWebhooks() : this.listInboxWebhooks(scope.email);
  }

  get(scope: WebhookScope, id: string): Observable<WebhookResponse> {
    return scope.type === 'global' ? this.getGlobalWebhook(id) : this.getInboxWebhook(scope.email, id);
  }

  create(scope: WebhookScope, dto: CreateWebhookDto): Observable<WebhookResponse> {
    return scope.type === 'global' ? this.createGlobalWebhook(dto) : this.createInboxWebhook(scope.email, dto);
  }

  update(scope: WebhookScope, id: string, dto: UpdateWebhookDto): Observable<WebhookResponse> {
    return scope.type === 'global' ? this.updateGlobalWebhook(id, dto) : this.updateInboxWebhook(scope.email, id, dto);
  }

  delete(scope: WebhookScope, id: string): Observable<void> {
    return scope.type === 'global' ? this.deleteGlobalWebhook(id) : this.deleteInboxWebhook(scope.email, id);
  }

  test(scope: WebhookScope, id: string): Observable<TestWebhookResponse> {
    return scope.type === 'global' ? this.testGlobalWebhook(id) : this.testInboxWebhook(scope.email, id);
  }

  rotateSecret(scope: WebhookScope, id: string): Observable<RotateSecretResponse> {
    return scope.type === 'global'
      ? this.rotateGlobalWebhookSecret(id)
      : this.rotateInboxWebhookSecret(scope.email, id);
  }
}
