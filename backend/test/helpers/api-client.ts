import request, { type SuperTest, type Test as SuperTestRequest } from 'supertest';
import type { App } from 'supertest/types';
import appConfig from '../../src/app.config';

export interface ApiClientOptions {
  apiKey?: string;
  basePath?: string;
}

export interface ChaosConfig {
  enabled: boolean;
  expiresAt?: string;
  latency?: {
    enabled: boolean;
    minDelayMs?: number;
    maxDelayMs?: number;
    jitter?: boolean;
    probability?: number;
  };
  connectionDrop?: {
    enabled: boolean;
    probability?: number;
    graceful?: boolean;
  };
  randomError?: {
    enabled: boolean;
    errorRate?: number;
    errorTypes?: ('temporary' | 'permanent')[];
  };
  greylist?: {
    enabled: boolean;
    retryWindowMs?: number;
    maxAttempts?: number;
    trackBy?: 'ip' | 'sender' | 'ip_sender';
  };
  blackhole?: {
    enabled: boolean;
    triggerWebhooks?: boolean;
  };
}

export interface CreateInboxBody {
  clientKemPk?: string;
  ttl?: number;
  emailAddress?: string;
  encryption?: 'encrypted' | 'plain';
  chaos?: ChaosConfig;
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

export interface FilterRuleBody {
  field: string;
  operator: string;
  value: string;
  caseSensitive?: boolean;
}

export interface FilterConfigBody {
  rules: FilterRuleBody[];
  mode: 'all' | 'any';
  requireAuth?: boolean;
}

export interface CustomTemplateBody {
  type: 'custom';
  body: string;
  contentType?: string;
}

export interface CreateWebhookBody {
  url: string;
  events: string[];
  template?: string | CustomTemplateBody;
  filter?: FilterConfigBody;
  description?: string;
}

export interface UpdateWebhookBody {
  url?: string;
  events?: string[];
  template?: string | CustomTemplateBody | null;
  filter?: FilterConfigBody | null;
  description?: string;
  enabled?: boolean;
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

  // ============================================
  // Global Webhooks
  // ============================================

  createGlobalWebhook(body: CreateWebhookBody) {
    return this.post('/webhooks').send(body);
  }

  listGlobalWebhooks() {
    return this.get('/webhooks');
  }

  getGlobalWebhook(id: string) {
    return this.get(`/webhooks/${encodeURIComponent(id)}`);
  }

  updateGlobalWebhook(id: string, body: UpdateWebhookBody) {
    return this.patch(`/webhooks/${encodeURIComponent(id)}`).send(body);
  }

  deleteGlobalWebhook(id: string) {
    return this.delete(`/webhooks/${encodeURIComponent(id)}`);
  }

  testGlobalWebhook(id: string) {
    return this.post(`/webhooks/${encodeURIComponent(id)}/test`);
  }

  rotateGlobalWebhookSecret(id: string) {
    return this.post(`/webhooks/${encodeURIComponent(id)}/rotate-secret`);
  }

  getWebhookMetrics() {
    return this.get('/webhooks/metrics');
  }

  getWebhookTemplates() {
    return this.get('/webhooks/templates');
  }

  // ============================================
  // Inbox Webhooks
  // ============================================

  createInboxWebhook(email: string, body: CreateWebhookBody) {
    return this.post(`/inboxes/${encodeURIComponent(email)}/webhooks`).send(body);
  }

  listInboxWebhooks(email: string) {
    return this.get(`/inboxes/${encodeURIComponent(email)}/webhooks`);
  }

  getInboxWebhook(email: string, id: string) {
    return this.get(`/inboxes/${encodeURIComponent(email)}/webhooks/${encodeURIComponent(id)}`);
  }

  updateInboxWebhook(email: string, id: string, body: UpdateWebhookBody) {
    return this.patch(`/inboxes/${encodeURIComponent(email)}/webhooks/${encodeURIComponent(id)}`).send(body);
  }

  deleteInboxWebhook(email: string, id: string) {
    return this.delete(`/inboxes/${encodeURIComponent(email)}/webhooks/${encodeURIComponent(id)}`);
  }

  testInboxWebhook(email: string, id: string) {
    return this.post(`/inboxes/${encodeURIComponent(email)}/webhooks/${encodeURIComponent(id)}/test`);
  }

  rotateInboxWebhookSecret(email: string, id: string) {
    return this.post(`/inboxes/${encodeURIComponent(email)}/webhooks/${encodeURIComponent(id)}/rotate-secret`);
  }

  // ============================================
  // Inbox Chaos Configuration
  // ============================================

  getChaosConfig(emailAddress: string) {
    return this.get(`/inboxes/${encodeURIComponent(emailAddress)}/chaos`);
  }

  setChaosConfig(emailAddress: string, config: ChaosConfig) {
    return this.post(`/inboxes/${encodeURIComponent(emailAddress)}/chaos`).send(config);
  }

  disableChaos(emailAddress: string) {
    return this.delete(`/inboxes/${encodeURIComponent(emailAddress)}/chaos`);
  }
}

export function createApiClient(server: App, options?: ApiClientOptions): ApiClient {
  return new ApiClient(server, options);
}
