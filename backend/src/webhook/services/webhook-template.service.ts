import { Injectable, Logger } from '@nestjs/common';
import { WebhookTemplate, BuiltInTemplate, CustomTemplate } from '../interfaces/webhook.interface';
import { WebhookEvent, TemplateContext, TemplateValidationResult } from '../interfaces/webhook-event.interface';

/**
 * Slack webhook template
 */
const SLACK_TEMPLATE = `{
  "text": "New email from {{data.from.address}}",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "New Email Received"
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*From:*\\n{{data.from.address}}"
        },
        {
          "type": "mrkdwn",
          "text": "*To:*\\n{{data.inboxEmail}}"
        }
      ]
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Subject:*\\n{{data.subject}}"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Preview:*\\n{{data.snippet}}"
      }
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "Event: \`{{type}}\` | ID: \`{{data.id}}\`"
        }
      ]
    }
  ]
}`;

/**
 * Discord webhook template
 */
const DISCORD_TEMPLATE = `{
  "content": "New email received",
  "embeds": [
    {
      "title": "{{data.subject}}",
      "color": 5814783,
      "fields": [
        {
          "name": "From",
          "value": "{{data.from.address}}",
          "inline": true
        },
        {
          "name": "To",
          "value": "{{data.inboxEmail}}",
          "inline": true
        },
        {
          "name": "Preview",
          "value": "{{data.snippet}}"
        }
      ],
      "footer": {
        "text": "VaultSandbox | {{type}}"
      },
      "timestamp": "{{timestamp}}"
    }
  ]
}`;

/**
 * Microsoft Teams webhook template
 */
const TEAMS_TEMPLATE = `{
  "@type": "MessageCard",
  "@context": "http://schema.org/extensions",
  "themeColor": "0076D7",
  "summary": "New email from {{data.from.address}}",
  "sections": [
    {
      "activityTitle": "New Email Received",
      "facts": [
        {
          "name": "From",
          "value": "{{data.from.address}}"
        },
        {
          "name": "To",
          "value": "{{data.inboxEmail}}"
        },
        {
          "name": "Subject",
          "value": "{{data.subject}}"
        }
      ],
      "text": "{{data.snippet}}"
    }
  ]
}`;

/**
 * Simple webhook template - minimal fields
 */
const SIMPLE_TEMPLATE = `{
  "from": "{{data.from.address}}",
  "to": "{{data.inboxEmail}}",
  "subject": "{{data.subject}}",
  "preview": "{{data.snippet}}"
}`;

/**
 * Notification webhook template - single text message
 */
const NOTIFICATION_TEMPLATE = `{
  "text": "New email from {{data.from.address}}: {{data.subject}}"
}`;

/**
 * Zapier/Automation webhook template - comprehensive fields for automation platforms
 */
const ZAPIER_TEMPLATE = `{
  "event": "{{type}}",
  "email_id": "{{data.id}}",
  "inbox": "{{data.inboxEmail}}",
  "from_address": "{{data.from.address}}",
  "from_name": "{{data.from.name}}",
  "subject": "{{data.subject}}",
  "preview": "{{data.snippet}}",
  "received_at": "{{data.receivedAt}}"
}`;

/**
 * Known built-in template names
 */
const BUILT_IN_TEMPLATE_NAMES: BuiltInTemplate[] = [
  'default',
  'slack',
  'discord',
  'teams',
  'simple',
  'notification',
  'zapier',
];

/**
 * Template options with display labels
 */
const BUILT_IN_TEMPLATE_OPTIONS: { label: string; value: BuiltInTemplate }[] = [
  { label: 'Default (Raw JSON)', value: 'default' },
  { label: 'Slack', value: 'slack' },
  { label: 'Discord', value: 'discord' },
  { label: 'Microsoft Teams', value: 'teams' },
  { label: 'Simple', value: 'simple' },
  { label: 'Notification', value: 'notification' },
  { label: 'Zapier/Automation', value: 'zapier' },
];

/**
 * Service for transforming webhook payloads using templates.
 * Supports built-in templates (Slack, Discord, Teams) and custom templates
 * with {{variable}} substitution syntax.
 */
@Injectable()
export class WebhookTemplateService {
  private readonly logger = new Logger(WebhookTemplateService.name);
  private readonly builtInTemplates: Map<string, string>;

  constructor() {
    this.builtInTemplates = new Map([
      ['slack', SLACK_TEMPLATE],
      ['discord', DISCORD_TEMPLATE],
      ['teams', TEAMS_TEMPLATE],
      ['simple', SIMPLE_TEMPLATE],
      ['notification', NOTIFICATION_TEMPLATE],
      ['zapier', ZAPIER_TEMPLATE],
    ]);
  }

  /**
   * Transform an event using the specified template.
   * Returns JSON string ready for HTTP delivery.
   */
  transform(event: WebhookEvent, template?: WebhookTemplate): string {
    // No template or 'default' = return original event as JSON
    if (!template || template === 'default') {
      return JSON.stringify(event);
    }

    // Built-in template (string name)
    if (typeof template === 'string') {
      const builtIn = this.builtInTemplates.get(template);
      if (!builtIn) {
        this.logger.warn(`Unknown template "${template}", using default`);
        return JSON.stringify(event);
      }
      return this.applyTemplate(builtIn, event);
    }

    // Custom template object
    if (this.isCustomTemplate(template)) {
      return this.applyTemplate(template.body, event);
    }

    // Fallback to default
    return JSON.stringify(event);
  }

  /**
   * Apply a template string to an event, replacing {{path}} placeholders
   */
  private applyTemplate(template: string, event: WebhookEvent): string {
    const context = this.buildContext(event);

    return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
      const value = this.getValueByPath(context, path.trim());
      return this.escapeJsonValue(value);
    });
  }

  /**
   * Build template context from event
   */
  private buildContext(event: WebhookEvent): TemplateContext {
    return {
      id: event.id,
      type: event.type,
      createdAt: event.createdAt,
      timestamp: new Date(event.createdAt * 1000).toISOString(),
      data: event.data,
    };
  }

  /**
   * Get a value from an object using a dot-notation path
   */
  private getValueByPath(obj: unknown, path: string): string {
    const parts = path.split('.');
    let value: unknown = obj;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }

    /* v8 ignore next 3 - defensive: ensures string return */
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    // Value is a primitive (string, number, boolean, symbol, bigint)
    return typeof value === 'string' ? value : String(value as number | boolean | bigint);
  }

  /**
   * Escape a value for safe inclusion in a JSON string.
   * This handles special characters that would break JSON syntax.
   */
  private escapeJsonValue(value: string): string {
    return JSON.stringify(value).slice(1, -1);
  }

  /**
   * Type guard for custom templates
   */
  private isCustomTemplate(template: WebhookTemplate): template is CustomTemplate {
    return typeof template === 'object' && template.type === 'custom';
  }

  /**
   * Validate a template configuration
   */
  validateTemplate(template: WebhookTemplate): TemplateValidationResult {
    // Built-in template name
    if (typeof template === 'string') {
      if (!BUILT_IN_TEMPLATE_NAMES.includes(template)) {
        return {
          valid: false,
          errors: [`Unknown built-in template: "${template}". Valid options: ${BUILT_IN_TEMPLATE_NAMES.join(', ')}`],
        };
      }
      return { valid: true, errors: [] };
    }

    // Custom template object
    if (this.isCustomTemplate(template)) {
      const errors: string[] = [];

      if (!template.body) {
        errors.push('Custom template body is required');
      } else {
        if (template.body.length > 10000) {
          errors.push('Template body exceeds 10,000 character limit');
        }

        // Validate that template produces valid JSON
        try {
          const testOutput = template.body.replace(/\{\{[^}]+\}\}/g, 'test');
          JSON.parse(testOutput);
        } catch {
          errors.push('Template does not produce valid JSON');
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    }

    return {
      valid: false,
      errors: ['Invalid template format'],
    };
  }

  /**
   * Check if a template name is a built-in template
   */
  isBuiltInTemplate(name: string): name is BuiltInTemplate {
    return BUILT_IN_TEMPLATE_NAMES.includes(name as BuiltInTemplate);
  }

  /**
   * Get list of available built-in templates
   */
  getBuiltInTemplateNames(): BuiltInTemplate[] {
    return [...BUILT_IN_TEMPLATE_NAMES];
  }

  /**
   * Get list of available built-in templates with labels for UI dropdowns
   */
  getBuiltInTemplateOptions(): { label: string; value: string }[] {
    return [...BUILT_IN_TEMPLATE_OPTIONS];
  }
}
