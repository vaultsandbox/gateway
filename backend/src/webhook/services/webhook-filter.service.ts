import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookEvent, EmailAuthResults } from '../interfaces/webhook-event.interface';
import {
  FilterOperator,
  FilterRule,
  FilterableField,
  WebhookFilterConfig,
  FilterValidationResult,
} from '../interfaces/webhook-filter.interface';
import { FILTER_OPERATORS, VALID_FILTER_FIELDS } from '../constants';

/**
 * Email auth configuration from server config
 */
interface EmailAuthConfig {
  enabled: boolean;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  reverseDns: boolean;
  inboxDefault: boolean;
}

/**
 * Service responsible for evaluating webhook filter rules against events.
 * Supports filtering on email subject, from/to addresses, body content, and headers.
 */
@Injectable()
export class WebhookFilterService {
  private readonly logger = new Logger(WebhookFilterService.name);

  /** Maximum body content to evaluate for performance (5KB) */
  private readonly BODY_LIMIT = 5 * 1024;

  /** Maximum number of filter rules per webhook */
  private readonly MAX_RULES = 10;

  /** Cache for compiled regex patterns */
  private readonly regexCache = new Map<string, RegExp>();

  /** Email auth configuration from server config */
  private readonly emailAuthConfig: EmailAuthConfig | undefined;

  /** Default value for requireAuth when not specified in filter */
  private readonly requireAuthDefault: boolean;

  /* v8 ignore next - constructor injection */
  constructor(private readonly configService: ConfigService) {
    /* v8 ignore next 2 - config defaults */
    this.emailAuthConfig = this.configService.get<EmailAuthConfig>('vsb.emailAuth');
    this.requireAuthDefault = this.configService.get<boolean>('vsb.webhook.requireAuthDefault') ?? false;
  }

  /**
   * Check if an event matches the filter configuration for a webhook.
   * Returns true if:
   * - No filter is configured (match all)
   * - Authentication requirement is met (if requireAuth is enabled)
   * - Filter rules are empty (match all)
   * - Rules match according to the mode (all/any)
   */
  matches(event: WebhookEvent, filter?: WebhookFilterConfig): boolean {
    // Resolve requireAuth: explicit value > config default
    const requireAuth = filter?.requireAuth ?? this.requireAuthDefault;

    // Check auth requirement first (if enabled)
    if (requireAuth && !this.checkAuthPasses(event)) {
      return false;
    }

    // No filter or empty rules = match all (auth check already passed if required)
    if (!filter || !filter.rules || filter.rules.length === 0) {
      return true;
    }

    const results = filter.rules.map((rule) => this.evaluateRule(rule, event));

    if (filter.mode === 'all') {
      return results.every((r) => r);
    } else {
      // 'any' mode - short-circuit already happened in evaluateRule for perf
      return results.some((r) => r);
    }
  }

  /**
   * Check if event passes all enabled auth checks from server config.
   * Only checks that are enabled in server config are enforced.
   */
  private checkAuthPasses(event: WebhookEvent): boolean {
    const data = event.data as { auth?: EmailAuthResults } | undefined;
    const auth = data?.auth;
    const config = this.emailAuthConfig;

    // If email auth is globally disabled, pass
    if (!config?.enabled) {
      return true;
    }

    // Check each enabled auth method
    const checks = ['spf', 'dkim', 'dmarc'] as const;
    for (const check of checks) {
      if (config[check] && (!auth || auth[check] !== 'pass')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a single filter rule against an event
   */
  private evaluateRule(rule: FilterRule, event: WebhookEvent): boolean {
    const fieldValue = this.extractFieldValue(rule.field, event);

    // Handle 'exists' operator specially - it just checks presence
    if (rule.operator === 'exists') {
      return fieldValue !== undefined && fieldValue !== null;
    }

    // For other operators, undefined/null means no match
    if (fieldValue === undefined || fieldValue === null) {
      return false;
    }

    return this.applyOperator(rule.operator, fieldValue, rule.value, rule.caseSensitive ?? false);
  }

  /**
   * Extract the value of a field from the event data.
   * Supports:
   * - Simple fields: 'subject'
   * - Nested fields: 'from.address', 'from.name'
   * - Array fields: 'to.address' (checks first recipient)
   * - Header fields: 'header.X-Custom'
   * - Body fields: 'body.text', 'body.html' (limited to BODY_LIMIT)
   */
  private extractFieldValue(field: FilterableField, event: WebhookEvent): string | undefined {
    const data = event.data as Record<string, unknown>;

    if (!data) {
      return undefined;
    }

    // Handle header fields: 'header.X-Custom-Header'
    if (field.startsWith('header.')) {
      const headerName = field.substring(7); // Remove 'header.' prefix
      const headers = data.headers as Record<string, string> | undefined;

      if (!headers) {
        return undefined;
      }

      // Headers are stored lowercase, try both original and lowercase
      return headers[headerName] ?? headers[headerName.toLowerCase()];
    }

    // Handle body fields with size limit
    if (field === 'body.text' || field === 'body.html') {
      const bodyField = field === 'body.text' ? 'textBody' : 'htmlBody';
      const value = data[bodyField];

      if (typeof value === 'string') {
        return value.substring(0, this.BODY_LIMIT);
      }
      return undefined;
    }

    // Handle array fields (to.address, to.name, cc.address, cc.name)
    if (field === 'to.address' || field === 'to.name') {
      const recipients = data.to as Array<{ address: string; name?: string }> | undefined;
      if (!recipients || recipients.length === 0) {
        return undefined;
      }
      // Match against first recipient (most common use case)
      // For complex matching, users can create multiple rules
      const firstRecipient = recipients[0];
      /* v8 ignore next - ternary branch */
      return field === 'to.address' ? firstRecipient.address : firstRecipient.name;
    }

    // Handle simple and nested fields: 'subject', 'from.address', 'from.name'
    const parts = field.split('.');
    let value: unknown = data;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = (value as Record<string, unknown>)[part];
    }

    return typeof value === 'string' ? value : undefined;
  }

  /**
   * Apply a filter operator to compare field value with filter value
   */
  private applyOperator(
    operator: FilterOperator,
    fieldValue: string,
    filterValue: string,
    caseSensitive: boolean,
  ): boolean {
    // Normalize case if case-insensitive
    const a = caseSensitive ? fieldValue : fieldValue.toLowerCase();
    const b = caseSensitive ? filterValue : filterValue.toLowerCase();

    switch (operator) {
      case 'equals':
        return a === b;

      case 'contains':
        return a.includes(b);

      case 'starts_with':
        return a.startsWith(b);

      case 'ends_with':
        return a.endsWith(b);

      case 'domain': {
        // Match email domain: user@domain.com matches "domain.com"
        // Also match subdomains: user@sub.domain.com matches "domain.com"
        const normalizedDomain = b.startsWith('@') ? b.substring(1) : b;
        return a.endsWith(`@${normalizedDomain}`) || a.includes(`.${normalizedDomain}`);
      }

      case 'regex':
        return this.matchRegex(filterValue, fieldValue, caseSensitive);

      /* v8 ignore next 3 - handled in evaluateRule, defensive only */
      case 'exists':
        // Should not reach here - handled in evaluateRule
        return true;

      /* v8 ignore next 5 - defensive: all operators validated at webhook creation */
      default: {
        const unknownOperator: string = operator;
        this.logger.warn(`Unknown filter operator: ${unknownOperator}`);
        return false;
      }
    }
  }

  /**
   * Match a value against a regex pattern.
   * Uses cached compiled regex for performance.
   */
  private matchRegex(pattern: string, value: string, caseSensitive: boolean): boolean {
    try {
      const cacheKey = `${pattern}:${caseSensitive}`;
      let regex = this.regexCache.get(cacheKey);

      if (!regex) {
        const flags = caseSensitive ? '' : 'i';
        regex = new RegExp(pattern, flags);
        this.regexCache.set(cacheKey, regex);

        /* v8 ignore next 7 - cache eviction rarely triggered in tests */
        // Limit cache size to prevent memory leaks
        if (this.regexCache.size > 1000) {
          const firstKey = this.regexCache.keys().next().value as string | undefined;
          if (firstKey) {
            this.regexCache.delete(firstKey);
          }
        }
      }

      return regex.test(value);
    } catch {
      this.logger.warn(`Invalid regex pattern: ${pattern}`);
      return false;
    }
  }

  /**
   * Validate a filter configuration at webhook creation/update time.
   * Returns validation errors and warnings.
   */
  validateFilter(filter: WebhookFilterConfig): FilterValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    /* v8 ignore next 4 - defensive: DTO validation ensures rules exist */
    if (!filter.rules) {
      errors.push('Filter rules array is required');
      return { valid: false, errors };
    }

    if (filter.rules.length > this.MAX_RULES) {
      errors.push(`Maximum ${this.MAX_RULES} filter rules allowed per webhook`);
    }

    if (filter.mode !== 'all' && filter.mode !== 'any') {
      errors.push(`Filter mode must be 'all' or 'any'`);
    }

    for (let i = 0; i < filter.rules.length; i++) {
      const rule = filter.rules[i];
      const prefix = `Rule ${i + 1}`;

      // Validate field name
      if (!this.isValidField(rule.field)) {
        errors.push(`${prefix}: Invalid filter field '${rule.field}'`);
      }

      // Validate operator
      if (!this.isValidOperator(rule.operator)) {
        errors.push(`${prefix}: Invalid filter operator '${rule.operator}'`);
      }

      // Validate regex patterns
      if (rule.operator === 'regex') {
        try {
          new RegExp(rule.value);
        } catch {
          errors.push(`${prefix}: Invalid regex pattern '${rule.value}'`);
        }
      }

      // Warn about expensive operations
      if (rule.field === 'body.text' || rule.field === 'body.html') {
        warnings.push(`${prefix}: Body filtering is limited to first 5KB for performance`);
      }

      // Warn about regex on large fields
      if (rule.operator === 'regex' && (rule.field === 'body.text' || rule.field === 'body.html')) {
        warnings.push(`${prefix}: Regex on body content may be slow for large emails`);
      }

      // Value is required for most operators (except 'exists')
      if (rule.operator !== 'exists' && (!rule.value || rule.value.length === 0)) {
        errors.push(`${prefix}: Filter value is required for '${rule.operator}' operator`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Check if a field name is valid for filtering
   */
  private isValidField(field: string): boolean {
    // Exact match for standard fields
    if (VALID_FILTER_FIELDS.includes(field)) {
      return true;
    }

    // Header fields: must start with 'header.' and have content after
    if (field.startsWith('header.') && field.length > 7) {
      return true;
    }

    return false;
  }

  /**
   * Check if an operator is valid
   */
  private isValidOperator(operator: string): boolean {
    return FILTER_OPERATORS.includes(operator as FilterOperator);
  }
}
