import type { FilterOperator } from '../interfaces/webhook-filter.interface';

/**
 * Valid filter operators for webhook filtering
 */
export const FILTER_OPERATORS: readonly FilterOperator[] = [
  'equals',
  'contains',
  'starts_with',
  'ends_with',
  'regex',
  'domain',
  'exists',
] as const;

/**
 * Valid fields that can be filtered on (excluding dynamic header.* fields)
 */
export const VALID_FILTER_FIELDS: readonly string[] = [
  'subject',
  'from.address',
  'from.name',
  'to.address',
  'to.name',
  'body.text',
  'body.html',
] as const;
