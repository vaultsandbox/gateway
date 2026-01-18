import { WebhookTemplateService } from '../webhook-template.service';
import { WebhookEvent } from '../../interfaces/webhook-event.interface';

describe('WebhookTemplateService', () => {
  let service: WebhookTemplateService;

  const createTestEvent = (dataOverrides: Record<string, unknown> = {}): WebhookEvent => ({
    id: 'evt_test123',
    object: 'event',
    createdAt: Math.floor(Date.now() / 1000),
    type: 'email.received',
    data: {
      id: 'msg_test123',
      inboxId: 'inbox_hash',
      inboxEmail: 'test@example.com',
      from: { address: 'sender@example.com', name: 'Test Sender' },
      to: [{ address: 'test@example.com' }],
      subject: 'Test Subject',
      snippet: 'Test snippet',
      receivedAt: new Date().toISOString(),
      headers: {},
      attachments: [],
      ...dataOverrides,
    },
  });

  beforeEach(() => {
    service = new WebhookTemplateService();
  });

  describe('transform', () => {
    it('should return raw JSON when no template is specified', () => {
      const event = createTestEvent();
      const result = service.transform(event);
      expect(JSON.parse(result)).toEqual(event);
    });

    it('should return raw JSON when template is "default"', () => {
      const event = createTestEvent();
      const result = service.transform(event, 'default');
      expect(JSON.parse(result)).toEqual(event);
    });

    it('should apply slack built-in template', () => {
      const event = createTestEvent();
      const result = service.transform(event, 'slack');
      const parsed = JSON.parse(result);
      expect(parsed.text).toContain('sender@example.com');
      expect(parsed.blocks).toBeDefined();
    });

    it('should apply discord built-in template', () => {
      const event = createTestEvent();
      const result = service.transform(event, 'discord');
      const parsed = JSON.parse(result);
      expect(parsed.embeds).toBeDefined();
      expect(parsed.embeds[0].title).toBe('Test Subject');
    });

    it('should apply teams built-in template', () => {
      const event = createTestEvent();
      const result = service.transform(event, 'teams');
      const parsed = JSON.parse(result);
      expect(parsed['@type']).toBe('MessageCard');
      expect(parsed.sections).toBeDefined();
    });

    it('should apply simple built-in template', () => {
      const event = createTestEvent();
      const result = service.transform(event, 'simple');
      const parsed = JSON.parse(result);
      expect(parsed.from).toBe('sender@example.com');
      expect(parsed.subject).toBe('Test Subject');
    });

    it('should apply notification built-in template', () => {
      const event = createTestEvent();
      const result = service.transform(event, 'notification');
      const parsed = JSON.parse(result);
      expect(parsed.text).toContain('sender@example.com');
      expect(parsed.text).toContain('Test Subject');
    });

    it('should apply zapier built-in template', () => {
      const event = createTestEvent();
      const result = service.transform(event, 'zapier');
      const parsed = JSON.parse(result);
      expect(parsed.event).toBe('email.received');
      expect(parsed.email_id).toBe('msg_test123');
    });

    it('should fall back to default for unknown string template', () => {
      const event = createTestEvent();
      const result = service.transform(event, 'unknown_template' as unknown as 'default');
      expect(JSON.parse(result)).toEqual(event);
    });

    it('should apply custom template', () => {
      const event = createTestEvent();
      const customTemplate = {
        type: 'custom' as const,
        body: '{"sender": "{{data.from.address}}", "subject": "{{data.subject}}"}',
      };
      const result = service.transform(event, customTemplate);
      const parsed = JSON.parse(result);
      expect(parsed.sender).toBe('sender@example.com');
      expect(parsed.subject).toBe('Test Subject');
    });

    it('should fall back to default for invalid template object', () => {
      const event = createTestEvent();
      const invalidTemplate = { type: 'invalid' } as unknown as { type: 'custom'; body: string };
      const result = service.transform(event, invalidTemplate);
      expect(JSON.parse(result)).toEqual(event);
    });
  });

  describe('applyTemplate', () => {
    it('should replace template variables with event data', () => {
      const event = createTestEvent();
      const template = { type: 'custom' as const, body: '{"id": "{{id}}", "eventType": "{{type}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.id).toBe('evt_test123');
      expect(parsed.eventType).toBe('email.received');
    });

    it('should handle timestamp variable', () => {
      const event = createTestEvent();
      const template = { type: 'custom' as const, body: '{"ts": "{{timestamp}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('getValueByPath', () => {
    it('should return empty string for undefined nested path', () => {
      const event = createTestEvent({ from: undefined });
      const template = { type: 'custom' as const, body: '{"sender": "{{data.from.address}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.sender).toBe('');
    });

    it('should return empty string for null nested value', () => {
      const event = createTestEvent({ from: null });
      const template = { type: 'custom' as const, body: '{"sender": "{{data.from.address}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.sender).toBe('');
    });

    it('should return empty string when path traverses non-object', () => {
      const event = createTestEvent({ from: 'not-an-object' });
      const template = { type: 'custom' as const, body: '{"sender": "{{data.from.address}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.sender).toBe('');
    });

    it('should stringify object values', () => {
      const event = createTestEvent();
      const template = { type: 'custom' as const, body: '{"from": "{{data.from}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.from).toContain('sender@example.com');
    });

    it('should convert number values to string', () => {
      const event = createTestEvent();
      const template = { type: 'custom' as const, body: '{"time": "{{createdAt}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(typeof parsed.time).toBe('string');
      expect(parseInt(parsed.time)).toBeGreaterThan(0);
    });

    it('should convert boolean values to string', () => {
      const event = {
        ...createTestEvent(),
        data: { ...createTestEvent().data, verified: true },
      };
      const template = { type: 'custom' as const, body: '{"verified": "{{data.verified}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.verified).toBe('true');
    });
  });

  describe('escapeJsonValue', () => {
    it('should escape quotes in values', () => {
      const event = createTestEvent({ subject: 'Test "quoted" subject' });
      const template = { type: 'custom' as const, body: '{"subject": "{{data.subject}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.subject).toBe('Test "quoted" subject');
    });

    it('should escape newlines in values', () => {
      const event = createTestEvent({ subject: 'Line1\nLine2' });
      const template = { type: 'custom' as const, body: '{"subject": "{{data.subject}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.subject).toBe('Line1\nLine2');
    });

    it('should escape backslashes in values', () => {
      const event = createTestEvent({ subject: 'Path\\to\\file' });
      const template = { type: 'custom' as const, body: '{"subject": "{{data.subject}}"}' };
      const result = service.transform(event, template);
      const parsed = JSON.parse(result);
      expect(parsed.subject).toBe('Path\\to\\file');
    });
  });

  describe('validateTemplate', () => {
    it('should accept valid built-in template names', () => {
      const templates = ['default', 'slack', 'discord', 'teams', 'simple', 'notification', 'zapier'] as const;
      for (const template of templates) {
        const result = service.validateTemplate(template);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should reject unknown built-in template names', () => {
      const result = service.validateTemplate('unknown' as unknown as 'default');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unknown built-in template');
    });

    it('should accept valid custom template', () => {
      const result = service.validateTemplate({
        type: 'custom',
        body: '{"test": "{{data.id}}"}',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject custom template without body', () => {
      const result = service.validateTemplate({
        type: 'custom',
        body: '',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Custom template body is required');
    });

    it('should reject custom template exceeding size limit', () => {
      const result = service.validateTemplate({
        type: 'custom',
        body: 'x'.repeat(10001),
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('10,000 character limit');
    });

    it('should reject custom template that does not produce valid JSON', () => {
      const result = service.validateTemplate({
        type: 'custom',
        body: '{"invalid": json}',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('valid JSON');
    });

    it('should reject invalid template format', () => {
      const result = service.validateTemplate({ invalid: 'format' } as unknown as { type: 'custom'; body: string });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid template format');
    });
  });

  describe('isBuiltInTemplate', () => {
    it('should return true for built-in template names', () => {
      expect(service.isBuiltInTemplate('default')).toBe(true);
      expect(service.isBuiltInTemplate('slack')).toBe(true);
      expect(service.isBuiltInTemplate('discord')).toBe(true);
      expect(service.isBuiltInTemplate('teams')).toBe(true);
      expect(service.isBuiltInTemplate('simple')).toBe(true);
      expect(service.isBuiltInTemplate('notification')).toBe(true);
      expect(service.isBuiltInTemplate('zapier')).toBe(true);
    });

    it('should return false for unknown template names', () => {
      expect(service.isBuiltInTemplate('unknown')).toBe(false);
      expect(service.isBuiltInTemplate('')).toBe(false);
    });
  });

  describe('getBuiltInTemplateNames', () => {
    it('should return array of built-in template names', () => {
      const names = service.getBuiltInTemplateNames();
      expect(names).toContain('default');
      expect(names).toContain('slack');
      expect(names).toContain('discord');
      expect(names).toContain('teams');
      expect(names).toContain('simple');
      expect(names).toContain('notification');
      expect(names).toContain('zapier');
    });

    it('should return a new array each time', () => {
      const names1 = service.getBuiltInTemplateNames();
      const names2 = service.getBuiltInTemplateNames();
      expect(names1).not.toBe(names2);
    });
  });

  describe('getBuiltInTemplateOptions', () => {
    it('should return array of template options with labels', () => {
      const options = service.getBuiltInTemplateOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toHaveProperty('label');
      expect(options[0]).toHaveProperty('value');
    });

    it('should include all built-in templates', () => {
      const options = service.getBuiltInTemplateOptions();
      const values = options.map((o) => o.value);
      expect(values).toContain('default');
      expect(values).toContain('slack');
    });

    it('should return a new array each time', () => {
      const options1 = service.getBuiltInTemplateOptions();
      const options2 = service.getBuiltInTemplateOptions();
      expect(options1).not.toBe(options2);
    });
  });
});
