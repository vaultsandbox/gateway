import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookFilterService } from '../webhook-filter.service';
import { WebhookEvent } from '../../interfaces/webhook-event.interface';
import { WebhookFilterConfig, FilterRule } from '../../interfaces/webhook-filter.interface';
import { silenceNestLogger } from '../../../../test/helpers/silence-logger';

describe('WebhookFilterService', () => {
  let service: WebhookFilterService;
  const restoreLogger = silenceNestLogger();

  // Default mock config - email auth enabled with all checks
  const defaultMockConfig = {
    'vsb.emailAuth': {
      enabled: true,
      spf: true,
      dkim: true,
      dmarc: true,
      reverseDns: true,
      inboxDefault: true,
    },
    'vsb.webhook.requireAuthDefault': false,
  };

  const createMockConfigService = (overrides: Record<string, unknown> = {}) => {
    const config = { ...defaultMockConfig, ...overrides };
    return {
      get: jest.fn((key: string) => config[key as keyof typeof config]),
    };
  };

  afterAll(() => restoreLogger());

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookFilterService,
        {
          provide: ConfigService,
          useValue: createMockConfigService(),
        },
      ],
    }).compile();

    service = module.get<WebhookFilterService>(WebhookFilterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('matches', () => {
    const createEmailEvent = (data: Partial<Record<string, unknown>> = {}): WebhookEvent => ({
      id: 'evt_test123',
      object: 'event',
      createdAt: Math.floor(Date.now() / 1000),
      type: 'email.received',
      data: {
        id: 'msg_test123',
        inboxId: 'inbox_hash_123',
        inboxEmail: 'test@example.com',
        from: { address: 'sender@github.com', name: 'GitHub' },
        to: [{ address: 'recipient@example.com', name: 'Test User' }],
        subject: 'Pull request opened',
        snippet: 'A new pull request has been opened',
        textBody: 'A new pull request has been opened in your repository',
        htmlBody: '<p>A new pull request has been opened</p>',
        headers: {
          'message-id': '<test@github.com>',
          'x-github-event': 'pull_request',
        },
        attachments: [],
        receivedAt: new Date().toISOString(),
        ...data,
      },
    });

    describe('when no filter is configured', () => {
      it('should return true when filter is undefined', () => {
        const event = createEmailEvent();
        expect(service.matches(event, undefined)).toBe(true);
      });

      it('should return true when filter has no rules', () => {
        const event = createEmailEvent();
        const filter: WebhookFilterConfig = { rules: [], mode: 'all' };
        expect(service.matches(event, filter)).toBe(true);
      });
    });

    describe('with equals operator', () => {
      it('should match exact subject', () => {
        const event = createEmailEvent({ subject: 'Password Reset' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'equals', value: 'password reset' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should match case-sensitive when specified', () => {
        const event = createEmailEvent({ subject: 'Password Reset' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'equals', value: 'Password Reset', caseSensitive: true }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should not match when case-sensitive and different case', () => {
        const event = createEmailEvent({ subject: 'Password Reset' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'equals', value: 'password reset', caseSensitive: true }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });
    });

    describe('with contains operator', () => {
      it('should match when subject contains value', () => {
        const event = createEmailEvent({ subject: 'Your password reset request' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'contains', value: 'password reset' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should not match when subject does not contain value', () => {
        const event = createEmailEvent({ subject: 'Your order confirmation' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'contains', value: 'password' }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });
    });

    describe('with starts_with operator', () => {
      it('should match when subject starts with value', () => {
        const event = createEmailEvent({ subject: 'Re: Your question' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'starts_with', value: 're:' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should not match when subject does not start with value', () => {
        const event = createEmailEvent({ subject: 'Your question' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'starts_with', value: 're:' }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });
    });

    describe('with ends_with operator', () => {
      it('should match when subject ends with value', () => {
        const event = createEmailEvent({ subject: 'Important [URGENT]' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'ends_with', value: '[urgent]' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should not match when subject does not end with value', () => {
        const event = createEmailEvent({ subject: '[URGENT] Important' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'ends_with', value: '[urgent]' }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });
    });

    describe('with domain operator', () => {
      it('should match email from specific domain', () => {
        const event = createEmailEvent({ from: { address: 'noreply@github.com', name: 'GitHub' } });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'from.address', operator: 'domain', value: 'github.com' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should match subdomain', () => {
        const event = createEmailEvent({ from: { address: 'noreply@notifications.github.com', name: 'GitHub' } });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'from.address', operator: 'domain', value: 'github.com' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should not match different domain', () => {
        const event = createEmailEvent({ from: { address: 'noreply@gitlab.com', name: 'GitLab' } });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'from.address', operator: 'domain', value: 'github.com' }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should handle domain with @ prefix', () => {
        const event = createEmailEvent({ from: { address: 'noreply@github.com', name: 'GitHub' } });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'from.address', operator: 'domain', value: '@github.com' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });
    });

    describe('with regex operator', () => {
      it('should match regex pattern', () => {
        const event = createEmailEvent({ subject: 'Issue #123: Bug fix' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'regex', value: 'Issue #\\d+' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should not match invalid regex pattern', () => {
        const event = createEmailEvent({ subject: 'Test subject' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'regex', value: '[invalid(' }],
        };
        // Invalid regex should return false, not throw
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should be case-insensitive by default', () => {
        const event = createEmailEvent({ subject: 'URGENT: Please respond' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'regex', value: 'urgent' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should be case-sensitive when specified', () => {
        const event = createEmailEvent({ subject: 'URGENT: Please respond' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'regex', value: 'urgent', caseSensitive: true }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });
    });

    describe('with exists operator', () => {
      it('should match when header exists', () => {
        const event = createEmailEvent({
          headers: { 'x-github-event': 'push' },
        });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'header.x-github-event', operator: 'exists', value: '' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should not match when header does not exist', () => {
        const event = createEmailEvent({
          headers: { 'message-id': '<test@example.com>' },
        });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'header.x-github-event', operator: 'exists', value: '' }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });
    });

    describe('with nested fields', () => {
      it('should extract from.address', () => {
        const event = createEmailEvent({ from: { address: 'test@example.com', name: 'Test' } });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'from.address', operator: 'equals', value: 'test@example.com' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should extract from.name', () => {
        const event = createEmailEvent({ from: { address: 'test@example.com', name: 'John Doe' } });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'from.name', operator: 'contains', value: 'john' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should extract to.address from first recipient', () => {
        const event = createEmailEvent({
          to: [
            { address: 'first@example.com', name: 'First' },
            { address: 'second@example.com', name: 'Second' },
          ],
        });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'to.address', operator: 'equals', value: 'first@example.com' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });
    });

    describe('with body fields', () => {
      it('should filter on text body', () => {
        const event = createEmailEvent({ textBody: 'Your password reset code is 123456' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'body.text', operator: 'contains', value: 'password reset' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should filter on html body', () => {
        const event = createEmailEvent({ htmlBody: '<p>Click <a href="#">here</a> to verify</p>' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'body.html', operator: 'contains', value: 'verify' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should limit body content to 5KB', () => {
        const longBody = 'x'.repeat(10000);
        const event = createEmailEvent({ textBody: longBody });
        // The filter service should truncate to 5KB
        expect(service.matches(event, { mode: 'all', rules: [] })).toBe(true);
      });
    });

    describe('with header fields', () => {
      it('should match header value', () => {
        const event = createEmailEvent({
          headers: { 'x-priority': '1' },
        });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'header.x-priority', operator: 'equals', value: '1' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should handle mixed-case header names', () => {
        const event = createEmailEvent({
          headers: { 'x-custom-header': 'test-value' },
        });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'header.X-Custom-Header', operator: 'equals', value: 'test-value' }],
        };
        expect(service.matches(event, filter)).toBe(true);
      });
    });

    describe('filter mode', () => {
      it('should require all rules to match in "all" mode', () => {
        const event = createEmailEvent({
          from: { address: 'noreply@github.com', name: 'GitHub' },
          subject: 'Pull request opened',
        });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [
            { field: 'from.address', operator: 'domain', value: 'github.com' },
            { field: 'subject', operator: 'contains', value: 'pull request' },
          ],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should fail in "all" mode when one rule does not match', () => {
        const event = createEmailEvent({
          from: { address: 'noreply@github.com', name: 'GitHub' },
          subject: 'Issue closed',
        });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [
            { field: 'from.address', operator: 'domain', value: 'github.com' },
            { field: 'subject', operator: 'contains', value: 'pull request' },
          ],
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should require at least one rule to match in "any" mode', () => {
        const event = createEmailEvent({
          from: { address: 'noreply@gitlab.com', name: 'GitLab' },
          subject: 'Pull request opened',
        });
        const filter: WebhookFilterConfig = {
          mode: 'any',
          rules: [
            { field: 'from.address', operator: 'domain', value: 'github.com' },
            { field: 'subject', operator: 'contains', value: 'pull request' },
          ],
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should fail in "any" mode when no rules match', () => {
        const event = createEmailEvent({
          from: { address: 'noreply@gitlab.com', name: 'GitLab' },
          subject: 'Issue closed',
        });
        const filter: WebhookFilterConfig = {
          mode: 'any',
          rules: [
            { field: 'from.address', operator: 'domain', value: 'github.com' },
            { field: 'subject', operator: 'contains', value: 'pull request' },
          ],
        };
        expect(service.matches(event, filter)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle missing event data', () => {
        const event: WebhookEvent = {
          id: 'evt_test123',
          object: 'event',
          createdAt: Math.floor(Date.now() / 1000),
          type: 'email.received',
          data: undefined as unknown,
        };
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'contains', value: 'test' }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should handle undefined field values', () => {
        const event = createEmailEvent({ from: { address: 'test@example.com' } }); // no name
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'from.name', operator: 'contains', value: 'test' }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should handle empty to array', () => {
        const event = createEmailEvent({ to: [] });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'to.address', operator: 'equals', value: 'test@example.com' }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should handle missing headers object', () => {
        const event = createEmailEvent({ headers: undefined });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'header.x-custom', operator: 'exists', value: '' }],
        };
        expect(service.matches(event, filter)).toBe(false);
      });
    });

    describe('with requireAuth', () => {
      const createEventWithAuth = (
        auth: { spf?: string; dkim?: string; dmarc?: string } | undefined,
      ): WebhookEvent => ({
        id: 'evt_test123',
        object: 'event',
        createdAt: Math.floor(Date.now() / 1000),
        type: 'email.received',
        data: {
          id: 'msg_test123',
          inboxId: 'inbox_hash_123',
          inboxEmail: 'test@example.com',
          from: { address: 'sender@github.com', name: 'GitHub' },
          to: [{ address: 'recipient@example.com', name: 'Test User' }],
          subject: 'Test email',
          snippet: 'Test snippet',
          headers: {},
          attachments: [],
          receivedAt: new Date().toISOString(),
          auth,
        },
      });

      it('should pass when requireAuth is false regardless of auth status', () => {
        const event = createEventWithAuth({ spf: 'fail', dkim: 'fail', dmarc: 'fail' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [],
          requireAuth: false,
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should pass when requireAuth is true and all enabled auth checks pass', () => {
        const event = createEventWithAuth({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [],
          requireAuth: true,
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should fail when requireAuth is true and SPF fails', () => {
        const event = createEventWithAuth({ spf: 'fail', dkim: 'pass', dmarc: 'pass' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [],
          requireAuth: true,
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should fail when requireAuth is true and DKIM fails', () => {
        const event = createEventWithAuth({ spf: 'pass', dkim: 'fail', dmarc: 'pass' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [],
          requireAuth: true,
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should fail when requireAuth is true and DMARC fails', () => {
        const event = createEventWithAuth({ spf: 'pass', dkim: 'pass', dmarc: 'fail' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [],
          requireAuth: true,
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should fail when requireAuth is true and no auth data on event', () => {
        const event = createEventWithAuth(undefined);
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [],
          requireAuth: true,
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should combine requireAuth with filter rules (both must match)', () => {
        const event = createEventWithAuth({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
        // Modify subject to match filter
        (event.data as { subject: string }).subject = 'Pull request opened';

        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'contains', value: 'pull request' }],
          requireAuth: true,
        };
        expect(service.matches(event, filter)).toBe(true);
      });

      it('should fail when auth passes but filter rules fail', () => {
        const event = createEventWithAuth({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'contains', value: 'not found' }],
          requireAuth: true,
        };
        expect(service.matches(event, filter)).toBe(false);
      });

      it('should fail when filter rules pass but auth fails', () => {
        const event = createEventWithAuth({ spf: 'fail', dkim: 'pass', dmarc: 'pass' });
        (event.data as { subject: string }).subject = 'Pull request opened';

        const filter: WebhookFilterConfig = {
          mode: 'all',
          rules: [{ field: 'subject', operator: 'contains', value: 'pull request' }],
          requireAuth: true,
        };
        expect(service.matches(event, filter)).toBe(false);
      });
    });
  });

  describe('requireAuth with different server configurations', () => {
    // Helper to create service with specific config
    const createServiceWithConfig = async (configOverrides: Record<string, unknown>) => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookFilterService,
          {
            provide: ConfigService,
            useValue: createMockConfigService(configOverrides),
          },
        ],
      }).compile();
      return module.get<WebhookFilterService>(WebhookFilterService);
    };

    const createEventWithAuth = (auth: { spf?: string; dkim?: string; dmarc?: string } | undefined): WebhookEvent => ({
      id: 'evt_test123',
      object: 'event',
      createdAt: Math.floor(Date.now() / 1000),
      type: 'email.received',
      data: {
        id: 'msg_test123',
        inboxId: 'inbox_hash_123',
        inboxEmail: 'test@example.com',
        from: { address: 'sender@example.com', name: 'Sender' },
        to: [{ address: 'recipient@example.com', name: 'Recipient' }],
        subject: 'Test',
        snippet: 'Test',
        headers: {},
        attachments: [],
        receivedAt: new Date().toISOString(),
        auth,
      },
    });

    it('should pass when email auth is globally disabled', async () => {
      const svc = await createServiceWithConfig({
        'vsb.emailAuth': { enabled: false, spf: true, dkim: true, dmarc: true },
      });
      const event = createEventWithAuth({ spf: 'fail', dkim: 'fail', dmarc: 'fail' });
      const filter: WebhookFilterConfig = { mode: 'all', rules: [], requireAuth: true };
      expect(svc.matches(event, filter)).toBe(true);
    });

    it('should skip disabled SPF check', async () => {
      const svc = await createServiceWithConfig({
        'vsb.emailAuth': { enabled: true, spf: false, dkim: true, dmarc: true },
      });
      const event = createEventWithAuth({ spf: 'fail', dkim: 'pass', dmarc: 'pass' });
      const filter: WebhookFilterConfig = { mode: 'all', rules: [], requireAuth: true };
      expect(svc.matches(event, filter)).toBe(true);
    });

    it('should skip disabled DKIM check', async () => {
      const svc = await createServiceWithConfig({
        'vsb.emailAuth': { enabled: true, spf: true, dkim: false, dmarc: true },
      });
      const event = createEventWithAuth({ spf: 'pass', dkim: 'fail', dmarc: 'pass' });
      const filter: WebhookFilterConfig = { mode: 'all', rules: [], requireAuth: true };
      expect(svc.matches(event, filter)).toBe(true);
    });

    it('should skip disabled DMARC check', async () => {
      const svc = await createServiceWithConfig({
        'vsb.emailAuth': { enabled: true, spf: true, dkim: true, dmarc: false },
      });
      const event = createEventWithAuth({ spf: 'pass', dkim: 'pass', dmarc: 'fail' });
      const filter: WebhookFilterConfig = { mode: 'all', rules: [], requireAuth: true };
      expect(svc.matches(event, filter)).toBe(true);
    });

    it('should use requireAuthDefault when requireAuth is undefined', async () => {
      const svc = await createServiceWithConfig({
        'vsb.webhook.requireAuthDefault': true,
      });
      const event = createEventWithAuth({ spf: 'fail', dkim: 'pass', dmarc: 'pass' });
      // No requireAuth specified - should use default (true)
      const filter: WebhookFilterConfig = { mode: 'all', rules: [] };
      expect(svc.matches(event, filter)).toBe(false);
    });

    it('should use requireAuthDefault false when not requiring auth', async () => {
      const svc = await createServiceWithConfig({
        'vsb.webhook.requireAuthDefault': false,
      });
      const event = createEventWithAuth({ spf: 'fail', dkim: 'fail', dmarc: 'fail' });
      // No requireAuth specified - should use default (false)
      const filter: WebhookFilterConfig = { mode: 'all', rules: [] };
      expect(svc.matches(event, filter)).toBe(true);
    });

    it('should allow explicit requireAuth: false to override requireAuthDefault: true', async () => {
      const svc = await createServiceWithConfig({
        'vsb.webhook.requireAuthDefault': true,
      });
      const event = createEventWithAuth({ spf: 'fail', dkim: 'fail', dmarc: 'fail' });
      const filter: WebhookFilterConfig = { mode: 'all', rules: [], requireAuth: false };
      expect(svc.matches(event, filter)).toBe(true);
    });

    it('should apply requireAuth even when no filter is provided (uses default)', async () => {
      const svc = await createServiceWithConfig({
        'vsb.webhook.requireAuthDefault': true,
      });
      const event = createEventWithAuth({ spf: 'fail', dkim: 'pass', dmarc: 'pass' });
      // undefined filter - should still apply requireAuthDefault
      expect(svc.matches(event, undefined)).toBe(false);
    });

    it('should pass when no filter provided and requireAuthDefault is false', async () => {
      const svc = await createServiceWithConfig({
        'vsb.webhook.requireAuthDefault': false,
      });
      const event = createEventWithAuth({ spf: 'fail', dkim: 'fail', dmarc: 'fail' });
      expect(svc.matches(event, undefined)).toBe(true);
    });
  });

  describe('validateFilter', () => {
    it('should accept valid filter configuration', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [
          { field: 'subject', operator: 'contains', value: 'test' },
          { field: 'from.address', operator: 'domain', value: 'example.com' },
        ],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject more than 10 rules', () => {
      const rules: FilterRule[] = Array(11)
        .fill(null)
        .map(() => ({
          field: 'subject' as const,
          operator: 'contains' as const,
          value: 'test',
        }));
      const filter: WebhookFilterConfig = { mode: 'all', rules };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Maximum 10 filter rules allowed per webhook');
    });

    it('should reject invalid field names', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'invalid.field' as any, operator: 'contains', value: 'test' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid filter field'))).toBe(true);
    });

    it('should reject invalid operators', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'subject', operator: 'invalid' as any, value: 'test' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid filter operator'))).toBe(true);
    });

    it('should reject invalid regex patterns', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'subject', operator: 'regex', value: '[invalid(' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid regex pattern'))).toBe(true);
    });

    it('should reject invalid mode', () => {
      const filter: WebhookFilterConfig = {
        mode: 'invalid' as any,
        rules: [{ field: 'subject', operator: 'contains', value: 'test' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Filter mode must be 'all' or 'any'"))).toBe(true);
    });

    it('should warn about body filtering', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'body.text', operator: 'contains', value: 'test' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(true);
      expect(result.warnings?.some((w) => w.includes('Body filtering is limited'))).toBe(true);
    });

    it('should warn about regex on body content', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'body.text', operator: 'regex', value: '.*' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(true);
      expect(result.warnings?.some((w) => w.includes('Regex on body content'))).toBe(true);
    });

    it('should require value for non-exists operators', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'subject', operator: 'contains', value: '' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Filter value is required'))).toBe(true);
    });

    it('should allow empty value for exists operator', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'header.x-custom', operator: 'exists', value: '' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(true);
    });

    it('should accept header fields with custom names', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'header.X-Custom-Header-Name', operator: 'equals', value: 'test' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(true);
    });

    it('should reject header field without name', () => {
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'header.' as any, operator: 'exists', value: '' }],
      };
      const result = service.validateFilter(filter);
      expect(result.valid).toBe(false);
    });
  });

  describe('regex caching', () => {
    it('should cache compiled regex patterns', () => {
      const event1 = {
        id: 'evt_1',
        object: 'event' as const,
        createdAt: Date.now(),
        type: 'email.received' as const,
        data: { subject: 'Issue #123' },
      };
      const event2 = {
        id: 'evt_2',
        object: 'event' as const,
        createdAt: Date.now(),
        type: 'email.received' as const,
        data: { subject: 'Issue #456' },
      };

      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'subject', operator: 'regex', value: 'Issue #\\d+' }],
      };

      // Should use same cached regex for both
      expect(service.matches(event1, filter)).toBe(true);
      expect(service.matches(event2, filter)).toBe(true);
    });
  });

  describe('extractFieldValue edge cases', () => {
    it('should return undefined for body fields with non-string values', () => {
      const event = {
        id: 'evt_test',
        object: 'event' as const,
        createdAt: Date.now(),
        type: 'email.received' as const,
        data: { textBody: 12345, htmlBody: { invalid: true } },
      };
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'body.text', operator: 'contains', value: 'test' }],
      };
      expect(service.matches(event, filter)).toBe(false);
    });

    it('should return undefined when nested path hits null', () => {
      const event = {
        id: 'evt_test',
        object: 'event' as const,
        createdAt: Date.now(),
        type: 'email.received' as const,
        data: { from: null },
      };
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'from.address', operator: 'equals', value: 'test@example.com' }],
      };
      expect(service.matches(event, filter)).toBe(false);
    });

    it('should return undefined when nested path value is not a string', () => {
      const event = {
        id: 'evt_test',
        object: 'event' as const,
        createdAt: Date.now(),
        type: 'email.received' as const,
        data: { from: { address: 12345 } },
      };
      const filter: WebhookFilterConfig = {
        mode: 'all',
        rules: [{ field: 'from.address', operator: 'equals', value: 'test@example.com' }],
      };
      expect(service.matches(event, filter)).toBe(false);
    });
  });
});
