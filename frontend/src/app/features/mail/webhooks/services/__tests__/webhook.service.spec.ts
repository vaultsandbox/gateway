import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { WebhookService } from '../webhook.service';
import {
  WebhookScope,
  WebhookListResponse,
  WebhookResponse,
  CreateWebhookDto,
  UpdateWebhookDto,
  TestWebhookResponse,
  RotateSecretResponse,
  WebhookTemplatesResponse,
} from '../../interfaces/webhook.interfaces';

describe('WebhookService', () => {
  let service: WebhookService;
  let httpClientStub: jasmine.SpyObj<HttpClient>;

  const createWebhook = (overrides: Partial<WebhookResponse> = {}): WebhookResponse => ({
    id: 'webhook-1',
    url: 'https://example.com/webhook',
    events: ['email.received'],
    scope: 'global',
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    httpClientStub = jasmine.createSpyObj('HttpClient', ['get', 'post', 'patch', 'delete']);

    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), WebhookService, { provide: HttpClient, useValue: httpClientStub }],
    });

    service = TestBed.inject(WebhookService);
  });

  // ==================== Global Webhooks ====================

  describe('listGlobalWebhooks', () => {
    it('calls GET /webhooks endpoint', () => {
      const response: WebhookListResponse = { webhooks: [createWebhook()], total: 1 };
      httpClientStub.get.and.returnValue(of(response));

      service.listGlobalWebhooks().subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks$/));
    });
  });

  describe('getGlobalWebhook', () => {
    it('calls GET /webhooks/:id endpoint', () => {
      const webhook = createWebhook();
      httpClientStub.get.and.returnValue(of(webhook));

      service.getGlobalWebhook('webhook-1').subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks\/webhook-1$/));
    });
  });

  describe('createGlobalWebhook', () => {
    it('calls POST /webhooks endpoint with dto', () => {
      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
      };
      const webhook = createWebhook();
      httpClientStub.post.and.returnValue(of(webhook));

      service.createGlobalWebhook(dto).subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks$/), dto);
    });
  });

  describe('updateGlobalWebhook', () => {
    it('calls PATCH /webhooks/:id endpoint with dto', () => {
      const dto: UpdateWebhookDto = { enabled: false };
      const webhook = createWebhook({ enabled: false });
      httpClientStub.patch.and.returnValue(of(webhook));

      service.updateGlobalWebhook('webhook-1', dto).subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.patch).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks\/webhook-1$/), dto);
    });
  });

  describe('deleteGlobalWebhook', () => {
    it('calls DELETE /webhooks/:id endpoint', () => {
      httpClientStub.delete.and.returnValue(of(void 0));

      service.deleteGlobalWebhook('webhook-1').subscribe();

      expect(httpClientStub.delete).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks\/webhook-1$/));
    });
  });

  describe('testGlobalWebhook', () => {
    it('calls POST /webhooks/:id/test endpoint', () => {
      const response: TestWebhookResponse = { success: true, statusCode: 200 };
      httpClientStub.post.and.returnValue(of(response));

      service.testGlobalWebhook('webhook-1').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks\/webhook-1\/test$/), {});
    });
  });

  describe('rotateGlobalWebhookSecret', () => {
    it('calls POST /webhooks/:id/rotate-secret endpoint', () => {
      const response: RotateSecretResponse = {
        id: 'webhook-1',
        secret: 'new-secret',
        previousSecretValidUntil: new Date().toISOString(),
      };
      httpClientStub.post.and.returnValue(of(response));

      service.rotateGlobalWebhookSecret('webhook-1').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/webhooks\/webhook-1\/rotate-secret$/),
        {},
      );
    });
  });

  // ==================== Templates ====================

  describe('getTemplates', () => {
    it('calls GET /webhooks/templates endpoint', () => {
      const response: WebhookTemplatesResponse = {
        templates: [
          { label: 'Default', value: 'default' },
          { label: 'Slack', value: 'slack' },
        ],
      };
      httpClientStub.get.and.returnValue(of(response));

      service.getTemplates().subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks\/templates$/));
    });
  });

  // ==================== Inbox Webhooks ====================

  describe('listInboxWebhooks', () => {
    it('calls GET /inboxes/:email/webhooks endpoint with encoded email', () => {
      const response: WebhookListResponse = { webhooks: [], total: 0 };
      httpClientStub.get.and.returnValue(of(response));

      service.listInboxWebhooks('test@example.com').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks$/),
      );
    });

    it('encodes special characters in email address', () => {
      httpClientStub.get.and.returnValue(of({ webhooks: [], total: 0 }));

      service.listInboxWebhooks('user+test@example.com').subscribe();

      expect(httpClientStub.get).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/user%2Btest%40example\.com\/webhooks$/),
      );
    });
  });

  describe('getInboxWebhook', () => {
    it('calls GET /inboxes/:email/webhooks/:id endpoint', () => {
      const webhook = createWebhook({ scope: 'inbox', inboxEmail: 'test@example.com' });
      httpClientStub.get.and.returnValue(of(webhook));

      service.getInboxWebhook('test@example.com', 'webhook-1').subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1$/),
      );
    });
  });

  describe('createInboxWebhook', () => {
    it('calls POST /inboxes/:email/webhooks endpoint with dto', () => {
      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
      };
      const webhook = createWebhook({ scope: 'inbox' });
      httpClientStub.post.and.returnValue(of(webhook));

      service.createInboxWebhook('test@example.com', dto).subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks$/),
        dto,
      );
    });
  });

  describe('updateInboxWebhook', () => {
    it('calls PATCH /inboxes/:email/webhooks/:id endpoint with dto', () => {
      const dto: UpdateWebhookDto = { enabled: false };
      const webhook = createWebhook({ scope: 'inbox', enabled: false });
      httpClientStub.patch.and.returnValue(of(webhook));

      service.updateInboxWebhook('test@example.com', 'webhook-1', dto).subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.patch).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1$/),
        dto,
      );
    });
  });

  describe('deleteInboxWebhook', () => {
    it('calls DELETE /inboxes/:email/webhooks/:id endpoint', () => {
      httpClientStub.delete.and.returnValue(of(void 0));

      service.deleteInboxWebhook('test@example.com', 'webhook-1').subscribe();

      expect(httpClientStub.delete).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1$/),
      );
    });
  });

  describe('testInboxWebhook', () => {
    it('calls POST /inboxes/:email/webhooks/:id/test endpoint', () => {
      const response: TestWebhookResponse = { success: true, statusCode: 200 };
      httpClientStub.post.and.returnValue(of(response));

      service.testInboxWebhook('test@example.com', 'webhook-1').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1\/test$/),
        {},
      );
    });
  });

  describe('rotateInboxWebhookSecret', () => {
    it('calls POST /inboxes/:email/webhooks/:id/rotate-secret endpoint', () => {
      const response: RotateSecretResponse = {
        id: 'webhook-1',
        secret: 'new-secret',
        previousSecretValidUntil: new Date().toISOString(),
      };
      httpClientStub.post.and.returnValue(of(response));

      service.rotateInboxWebhookSecret('test@example.com', 'webhook-1').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1\/rotate-secret$/),
        {},
      );
    });
  });

  // ==================== Unified Scope-Aware Methods ====================

  describe('list', () => {
    it('calls listGlobalWebhooks for global scope', () => {
      const scope: WebhookScope = { type: 'global' };
      const response: WebhookListResponse = { webhooks: [], total: 0 };
      httpClientStub.get.and.returnValue(of(response));

      service.list(scope).subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks$/));
    });

    it('calls listInboxWebhooks for inbox scope', () => {
      const scope: WebhookScope = { type: 'inbox', email: 'test@example.com' };
      const response: WebhookListResponse = { webhooks: [], total: 0 };
      httpClientStub.get.and.returnValue(of(response));

      service.list(scope).subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks$/),
      );
    });
  });

  describe('get', () => {
    it('calls getGlobalWebhook for global scope', () => {
      const scope: WebhookScope = { type: 'global' };
      const webhook = createWebhook();
      httpClientStub.get.and.returnValue(of(webhook));

      service.get(scope, 'webhook-1').subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks\/webhook-1$/));
    });

    it('calls getInboxWebhook for inbox scope', () => {
      const scope: WebhookScope = { type: 'inbox', email: 'test@example.com' };
      const webhook = createWebhook({ scope: 'inbox' });
      httpClientStub.get.and.returnValue(of(webhook));

      service.get(scope, 'webhook-1').subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1$/),
      );
    });
  });

  describe('create', () => {
    it('calls createGlobalWebhook for global scope', () => {
      const scope: WebhookScope = { type: 'global' };
      const dto: CreateWebhookDto = { url: 'https://example.com', events: ['email.received'] };
      const webhook = createWebhook();
      httpClientStub.post.and.returnValue(of(webhook));

      service.create(scope, dto).subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks$/), dto);
    });

    it('calls createInboxWebhook for inbox scope', () => {
      const scope: WebhookScope = { type: 'inbox', email: 'test@example.com' };
      const dto: CreateWebhookDto = { url: 'https://example.com', events: ['email.received'] };
      const webhook = createWebhook({ scope: 'inbox' });
      httpClientStub.post.and.returnValue(of(webhook));

      service.create(scope, dto).subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks$/),
        dto,
      );
    });
  });

  describe('update', () => {
    it('calls updateGlobalWebhook for global scope', () => {
      const scope: WebhookScope = { type: 'global' };
      const dto: UpdateWebhookDto = { enabled: false };
      const webhook = createWebhook({ enabled: false });
      httpClientStub.patch.and.returnValue(of(webhook));

      service.update(scope, 'webhook-1', dto).subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.patch).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks\/webhook-1$/), dto);
    });

    it('calls updateInboxWebhook for inbox scope', () => {
      const scope: WebhookScope = { type: 'inbox', email: 'test@example.com' };
      const dto: UpdateWebhookDto = { enabled: false };
      const webhook = createWebhook({ scope: 'inbox', enabled: false });
      httpClientStub.patch.and.returnValue(of(webhook));

      service.update(scope, 'webhook-1', dto).subscribe((result) => {
        expect(result).toEqual(webhook);
      });

      expect(httpClientStub.patch).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1$/),
        dto,
      );
    });
  });

  describe('delete', () => {
    it('calls deleteGlobalWebhook for global scope', () => {
      const scope: WebhookScope = { type: 'global' };
      httpClientStub.delete.and.returnValue(of(void 0));

      service.delete(scope, 'webhook-1').subscribe();

      expect(httpClientStub.delete).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks\/webhook-1$/));
    });

    it('calls deleteInboxWebhook for inbox scope', () => {
      const scope: WebhookScope = { type: 'inbox', email: 'test@example.com' };
      httpClientStub.delete.and.returnValue(of(void 0));

      service.delete(scope, 'webhook-1').subscribe();

      expect(httpClientStub.delete).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1$/),
      );
    });
  });

  describe('test', () => {
    it('calls testGlobalWebhook for global scope', () => {
      const scope: WebhookScope = { type: 'global' };
      const response: TestWebhookResponse = { success: true, statusCode: 200 };
      httpClientStub.post.and.returnValue(of(response));

      service.test(scope, 'webhook-1').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(jasmine.stringMatching(/\/webhooks\/webhook-1\/test$/), {});
    });

    it('calls testInboxWebhook for inbox scope', () => {
      const scope: WebhookScope = { type: 'inbox', email: 'test@example.com' };
      const response: TestWebhookResponse = { success: true, statusCode: 200 };
      httpClientStub.post.and.returnValue(of(response));

      service.test(scope, 'webhook-1').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1\/test$/),
        {},
      );
    });
  });

  describe('rotateSecret', () => {
    it('calls rotateGlobalWebhookSecret for global scope', () => {
      const scope: WebhookScope = { type: 'global' };
      const response: RotateSecretResponse = {
        id: 'webhook-1',
        secret: 'new-secret',
        previousSecretValidUntil: new Date().toISOString(),
      };
      httpClientStub.post.and.returnValue(of(response));

      service.rotateSecret(scope, 'webhook-1').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/webhooks\/webhook-1\/rotate-secret$/),
        {},
      );
    });

    it('calls rotateInboxWebhookSecret for inbox scope', () => {
      const scope: WebhookScope = { type: 'inbox', email: 'test@example.com' };
      const response: RotateSecretResponse = {
        id: 'webhook-1',
        secret: 'new-secret',
        previousSecretValidUntil: new Date().toISOString(),
      };
      httpClientStub.post.and.returnValue(of(response));

      service.rotateSecret(scope, 'webhook-1').subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/webhooks\/webhook-1\/rotate-secret$/),
        {},
      );
    });
  });
});
