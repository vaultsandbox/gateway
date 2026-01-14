import request, { type SuperTest, type Test as SuperTestRequest } from 'supertest';
import type { App } from 'supertest/types';
import appConfig from '../../src/app.config';

export interface ApiClientOptions {
  apiKey?: string;
  basePath?: string;
}

export interface CreateInboxBody {
  clientKemPk?: string;
  ttl?: number;
  emailAddress?: string;
  encryption?: 'encrypted' | 'plain';
}

export interface AuthOptions {
  spf?: 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror';
  dkim?: 'pass' | 'fail' | 'none';
  dmarc?: 'pass' | 'fail' | 'none';
  reverseDns?: boolean;
}

export interface CreateTestEmailBody {
  to: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  auth?: AuthOptions;
}

export class ApiClient {
  private readonly http: SuperTest<SuperTestRequest>;
  private readonly basePath: string;
  private readonly apiKey: string;

  constructor(server: App, options: ApiClientOptions = {}) {
    this.http = request(server);
    this.basePath = (options.basePath ?? '/api').replace(/\/$/, '');
    const config = appConfig();
    const defaultApiKey = config.local.apiKey || 'vsb-e2e-api-key';
    this.apiKey = options.apiKey ?? defaultApiKey;
  }

  private buildPath(path: string): string {
    if (/^https?:\/\//.test(path)) {
      return path;
    }
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${this.basePath}${normalized}`;
  }

  private withHeaders(test: SuperTestRequest) {
    return test.set('x-api-key', this.apiKey);
  }

  get(path: string) {
    return this.withHeaders(this.http.get(this.buildPath(path)));
  }

  post(path: string) {
    return this.withHeaders(this.http.post(this.buildPath(path)));
  }

  patch(path: string) {
    return this.withHeaders(this.http.patch(this.buildPath(path)));
  }

  delete(path: string) {
    return this.withHeaders(this.http.delete(this.buildPath(path)));
  }

  createInbox(body: CreateInboxBody) {
    return this.post('/inboxes').send(body);
  }

  listInboxEmails(emailAddress: string) {
    return this.get(`/inboxes/${encodeURIComponent(emailAddress)}/emails`);
  }

  getEmail(emailAddress: string, emailId: string) {
    return this.get(`/inboxes/${encodeURIComponent(emailAddress)}/emails/${emailId}`);
  }

  getRawEmail(emailAddress: string, emailId: string) {
    return this.get(`/inboxes/${encodeURIComponent(emailAddress)}/emails/${emailId}/raw`);
  }

  markEmailAsRead(emailAddress: string, emailId: string) {
    return this.patch(`/inboxes/${encodeURIComponent(emailAddress)}/emails/${emailId}/read`);
  }

  getInboxSyncStatus(emailAddress: string) {
    return this.get(`/inboxes/${encodeURIComponent(emailAddress)}/sync`);
  }

  deleteEmail(emailAddress: string, emailId: string) {
    return this.delete(`/inboxes/${encodeURIComponent(emailAddress)}/emails/${emailId}`);
  }

  deleteInbox(emailAddress: string) {
    return this.delete(`/inboxes/${encodeURIComponent(emailAddress)}`);
  }

  clearAllInboxes() {
    return this.delete('/inboxes');
  }

  getServerInfo() {
    return this.get('/server-info');
  }

  checkApiKey() {
    return this.get('/check-key');
  }

  createTestEmail(body: CreateTestEmailBody) {
    return this.post('/test/emails').send(body);
  }
}

export function createApiClient(server: App, options?: ApiClientOptions): ApiClient {
  return new ApiClient(server, options);
}
