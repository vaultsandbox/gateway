/**
 * Filter operators for matching webhook events
 */
export type FilterOperator =
  | 'equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'regex'
  | 'domain' // for email addresses (e.g., matches @example.com)
  | 'exists'; // for headers (check if field exists)

/**
 * Fields that can be filtered on.
 * Supports dot notation for nested fields and dynamic header names.
 */
export type FilterableField =
  | 'subject'
  | 'from.address'
  | 'from.name'
  | 'to.address'
  | 'to.name'
  | 'body.text'
  | 'body.html'
  | `header.${string}`; // e.g., 'header.X-GitHub-Event'

/**
 * A single filter rule to match against event data
 */
export interface FilterRule {
  /** The field to match against */
  field: FilterableField;

  /** The operator to use for matching */
  operator: FilterOperator;

  /** The value to match (empty string for 'exists' operator) */
  value: string;

  /** Whether to perform case-sensitive matching (default: false) */
  caseSensitive?: boolean;
}

/**
 * Filter configuration for a webhook
 */
export interface WebhookFilterConfig {
  /** List of filter rules to apply */
  rules: FilterRule[];

  /** How to combine rules: 'all' = AND logic, 'any' = OR logic */
  mode: 'all' | 'any';

  /**
   * If true, webhook only fires when email passes all enabled
   * authentication checks configured on the server (SPF, DKIM, DMARC).
   * Disabled checks in server config are skipped.
   *
   * Default value comes from VSB_WEBHOOK_REQUIRE_AUTH_DEFAULT env var.
   */
  requireAuth?: boolean;
}

/**
 * Result of validating a filter configuration
 */
export interface FilterValidationResult {
  /** Whether the filter configuration is valid */
  valid: boolean;

  /** List of validation errors (empty if valid) */
  errors: string[];

  /** List of warnings (non-blocking issues) */
  warnings?: string[];
}
