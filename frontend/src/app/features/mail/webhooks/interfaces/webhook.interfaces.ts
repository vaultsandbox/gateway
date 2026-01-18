// Event types
export type WebhookEventType = 'email.received' | 'email.stored' | 'email.deleted';

// Template types
export type BuiltInTemplate = 'default' | 'slack' | 'discord' | 'teams';

export interface CustomTemplate {
  type: 'custom';
  body: string;
  contentType?: string;
}

export type WebhookTemplate = BuiltInTemplate | CustomTemplate;

// Filter types
export type FilterableField =
  | 'subject'
  | 'from.address'
  | 'from.name'
  | 'to.address'
  | 'to.name'
  | 'body.text'
  | 'body.html'
  | string; // For header.X-Custom fields

export type FilterOperator = 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'domain' | 'regex' | 'exists';

export interface FilterRule {
  field: FilterableField;
  operator: FilterOperator;
  value: string;
  caseSensitive?: boolean;
}

export interface FilterConfig {
  rules: FilterRule[];
  mode: 'all' | 'any';
  requireAuth?: boolean;
}

// Request DTOs
export interface CreateWebhookDto {
  url: string;
  events: WebhookEventType[];
  template?: BuiltInTemplate | CustomTemplate;
  filter?: FilterConfig;
  description?: string;
}

export interface UpdateWebhookDto {
  url?: string;
  events?: WebhookEventType[];
  template?: BuiltInTemplate | CustomTemplate | null;
  filter?: FilterConfig | null;
  description?: string;
  enabled?: boolean;
}

// Response DTOs
export interface WebhookStats {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
}

export interface WebhookResponse {
  id: string;
  url: string;
  events: WebhookEventType[];
  scope: 'global' | 'inbox';
  inboxEmail?: string;
  inboxHash?: string;
  enabled: boolean;
  secret?: string;
  template?: WebhookTemplate;
  filter?: FilterConfig;
  description?: string;
  createdAt: string;
  updatedAt?: string;
  lastDeliveryAt?: string;
  lastDeliveryStatus?: 'success' | 'failed';
  stats?: WebhookStats;
}

export interface WebhookListResponse {
  webhooks: WebhookResponse[];
  total: number;
}

export interface TestWebhookResponse {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  responseBody?: string;
  error?: string;
  payloadSent?: unknown;
}

export interface RotateSecretResponse {
  id: string;
  secret: string;
  previousSecretValidUntil: string;
}

// Template API response
export interface WebhookTemplateOption {
  label: string;
  value: string;
}

export interface WebhookTemplatesResponse {
  templates: WebhookTemplateOption[];
}

// Scope type for shared components
export type WebhookScope = { type: 'global' } | { type: 'inbox'; email: string };

// Error response from API
export interface WebhookErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
}

// ==================== Event Payloads (for reference) ====================

export interface WebhookEventEnvelope<T> {
  id: string; // evt_ prefix
  object: 'event';
  createdAt: number; // Unix timestamp
  type: WebhookEventType;
  data: T;
}

export interface EmailAddress {
  address: string;
  name?: string;
}

export interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
}

export interface EmailAuthResults {
  spf?: string;
  dkim?: string;
  dmarc?: string;
}

export interface EmailReceivedData {
  id: string;
  inboxId: string;
  inboxEmail: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  snippet: string;
  textBody?: string;
  htmlBody?: string;
  headers: Record<string, string>;
  attachments: AttachmentMeta[];
  auth?: EmailAuthResults;
  receivedAt: string;
}

export interface EmailStoredData {
  id: string;
  inboxId: string;
  inboxEmail: string;
  storedAt: string;
}

export interface EmailDeletedData {
  id: string;
  inboxId: string;
  inboxEmail: string;
  reason: 'manual' | 'ttl' | 'eviction';
  deletedAt: string;
}

// Constants for UI
export const WEBHOOK_EVENT_OPTIONS: { label: string; value: WebhookEventType }[] = [
  { label: 'Email Received', value: 'email.received' },
  { label: 'Email Stored', value: 'email.stored' },
  { label: 'Email Deleted', value: 'email.deleted' },
];

export const CUSTOM_TEMPLATE_OPTION: WebhookTemplateOption = { label: 'Custom', value: 'custom' };

export const FILTER_FIELD_OPTIONS: { label: string; value: FilterableField }[] = [
  { label: 'Subject', value: 'subject' },
  { label: 'From Address', value: 'from.address' },
  { label: 'From Name', value: 'from.name' },
  { label: 'To Address', value: 'to.address' },
  { label: 'To Name', value: 'to.name' },
  { label: 'Body (Text)', value: 'body.text' },
  { label: 'Body (HTML)', value: 'body.html' },
];

export const FILTER_OPERATOR_OPTIONS: { label: string; value: FilterOperator }[] = [
  { label: 'Equals', value: 'equals' },
  { label: 'Contains', value: 'contains' },
  { label: 'Starts with', value: 'starts_with' },
  { label: 'Ends with', value: 'ends_with' },
  { label: 'Domain', value: 'domain' },
  { label: 'Regex', value: 'regex' },
  { label: 'Exists', value: 'exists' },
];

export const FILTER_MODE_OPTIONS: { label: string; value: 'all' | 'any' }[] = [
  { label: 'Match ALL rules', value: 'all' },
  { label: 'Match ANY rule', value: 'any' },
];
