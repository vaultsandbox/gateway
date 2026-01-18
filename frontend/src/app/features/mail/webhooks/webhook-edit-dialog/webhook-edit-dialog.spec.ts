import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, ComponentRef } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { WebhookEditDialog } from './webhook-edit-dialog';
import { WebhookService } from '../services/webhook.service';
import { ServerInfoService } from '../../services/server-info.service';
import { VsToast } from '../../../../shared/services/vs-toast';
import { WebhookResponse, WebhookScope } from '../interfaces/webhook.interfaces';
import { VsToastStub, ServerInfoServiceStub } from '../../../../../testing/mail-testing.mocks';

describe('WebhookEditDialog', () => {
  let component: WebhookEditDialog;
  let componentRef: ComponentRef<WebhookEditDialog>;
  let fixture: ComponentFixture<WebhookEditDialog>;
  let webhookServiceStub: jasmine.SpyObj<WebhookService>;
  let serverInfoServiceStub: ServerInfoServiceStub;
  let toastStub: VsToastStub;
  let confirmationServiceStub: jasmine.SpyObj<ConfirmationService>;

  const createWebhook = (overrides: Partial<WebhookResponse> = {}): WebhookResponse => ({
    id: 'webhook-1',
    url: 'https://example.com/webhook',
    events: ['email.received'],
    scope: 'global',
    enabled: true,
    secret: 'test-secret',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  const globalScope: WebhookScope = { type: 'global' };

  beforeEach(async () => {
    webhookServiceStub = jasmine.createSpyObj('WebhookService', ['getTemplates', 'create', 'update', 'rotateSecret']);
    serverInfoServiceStub = new ServerInfoServiceStub();
    toastStub = new VsToastStub();
    confirmationServiceStub = jasmine.createSpyObj('ConfirmationService', ['confirm']);

    webhookServiceStub.getTemplates.and.returnValue(
      of({
        templates: [
          { label: 'Default', value: 'default' },
          { label: 'Slack', value: 'slack' },
        ],
      }),
    );

    await TestBed.configureTestingModule({
      imports: [WebhookEditDialog],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: WebhookService, useValue: webhookServiceStub },
        { provide: ServerInfoService, useValue: serverInfoServiceStub },
        { provide: VsToast, useValue: toastStub },
        { provide: ConfirmationService, useValue: confirmationServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WebhookEditDialog);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('scope', globalScope);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('loads templates on init', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(webhookServiceStub.getTemplates).toHaveBeenCalled();
      expect(component.templateOptions().length).toBeGreaterThan(0);
    });

    it('adds custom option to templates', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      const customOption = component.templateOptions().find((t) => t.value === 'custom');
      expect(customOption).toBeDefined();
    });

    it('falls back to custom option only if API fails', async () => {
      webhookServiceStub.getTemplates.and.returnValue(throwError(() => new Error('Failed')));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.templateOptions().length).toBe(1);
      expect(component.templateOptions()[0].value).toBe('custom');
    });
  });

  describe('isEditMode', () => {
    it('returns false for new webhook', () => {
      componentRef.setInput('webhook', null);
      fixture.detectChanges();

      expect(component.isEditMode()).toBeFalse();
    });

    it('returns true for existing webhook', () => {
      componentRef.setInput('webhook', createWebhook());
      fixture.detectChanges();

      expect(component.isEditMode()).toBeTrue();
    });
  });

  describe('loadWebhookData', () => {
    it('populates form with webhook data in edit mode', () => {
      const webhook = createWebhook({
        url: 'https://my-webhook.com',
        description: 'Test webhook',
        events: ['email.received', 'email.stored'],
        template: 'slack',
      });
      componentRef.setInput('webhook', webhook);
      fixture.detectChanges();

      expect(component.url()).toBe('https://my-webhook.com');
      expect(component.description()).toBe('Test webhook');
      expect(component.events()).toEqual(['email.received', 'email.stored']);
      expect(component.templateType()).toBe('slack');
    });

    it('loads custom template data', () => {
      const webhook = createWebhook({
        template: {
          type: 'custom',
          body: '{"text": "test"}',
          contentType: 'application/json',
        },
      });
      componentRef.setInput('webhook', webhook);
      fixture.detectChanges();

      expect(component.templateType()).toBe('custom');
      expect(component.customTemplateBody()).toBe('{"text": "test"}');
      expect(component.customContentType()).toBe('application/json');
    });

    it('loads filter data', () => {
      const webhook = createWebhook({
        filter: {
          rules: [{ field: 'subject', operator: 'contains', value: 'test' }],
          mode: 'any',
          requireAuth: true,
        },
      });
      componentRef.setInput('webhook', webhook);
      fixture.detectChanges();

      expect(component.filterEnabled()).toBeTrue();
      expect(component.filterConfig().rules.length).toBe(1);
      expect(component.filterConfig().mode).toBe('any');
    });

    it('sets default requireAuth from server config for new webhook', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: true,
      });
      componentRef.setInput('webhook', null);
      fixture.detectChanges();

      expect(component.filterConfig().requireAuth).toBeTrue();
    });
  });

  describe('URL validation', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('returns null error for empty URL', () => {
      component.url.set('');
      expect(component.urlError()).toBeNull();
    });

    it('returns error for invalid URL', () => {
      component.url.set('not-a-url');
      expect(component.urlError()).toBe('Invalid URL format');
    });

    it('returns error for non-HTTP/HTTPS protocol', () => {
      component.url.set('ftp://example.com');
      expect(component.urlError()).toBe('URL must use HTTPS or HTTP protocol');
    });

    it('returns null error for valid HTTPS URL', () => {
      component.url.set('https://example.com/webhook');
      expect(component.urlError()).toBeNull();
    });

    it('returns null error for valid HTTP URL', () => {
      component.url.set('http://example.com/webhook');
      expect(component.urlError()).toBeNull();
    });
  });

  describe('URL warning', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('returns warning for HTTP URL', () => {
      component.url.set('http://example.com');
      expect(component.urlWarning()).toBe('HTTP is not secure. Consider using HTTPS.');
    });

    it('returns null for HTTPS URL', () => {
      component.url.set('https://example.com');
      expect(component.urlWarning()).toBeNull();
    });

    it('returns null for invalid URL', () => {
      component.url.set('not-a-url');
      expect(component.urlWarning()).toBeNull();
    });
  });

  describe('template validation', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('returns null for non-custom template', () => {
      component.templateType.set('slack');
      expect(component.templateError()).toBeNull();
    });

    it('returns error for empty custom template body', () => {
      component.templateType.set('custom');
      component.customTemplateBody.set('');
      expect(component.templateError()).toBe('Custom template body is required');
    });

    it('returns error for invalid JSON', () => {
      component.templateType.set('custom');
      component.customTemplateBody.set('not json');
      expect(component.templateError()).toBe('Invalid JSON format');
    });

    it('returns null for valid JSON custom template', () => {
      component.templateType.set('custom');
      component.customTemplateBody.set('{"text": "test"}');
      expect(component.templateError()).toBeNull();
    });
  });

  describe('isValid', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('returns false for empty URL', () => {
      component.url.set('');
      expect(component.isValid()).toBeFalse();
    });

    it('returns false for invalid URL', () => {
      component.url.set('not-a-url');
      component.events.set(['email.received']);
      expect(component.isValid()).toBeFalse();
    });

    it('returns false for empty events', () => {
      component.url.set('https://example.com');
      component.events.set([]);
      expect(component.isValid()).toBeFalse();
    });

    it('returns false for invalid custom template', () => {
      component.url.set('https://example.com');
      component.events.set(['email.received']);
      component.templateType.set('custom');
      component.customTemplateBody.set('invalid json');
      expect(component.isValid()).toBeFalse();
    });

    it('returns false for description over 500 characters', () => {
      component.url.set('https://example.com');
      component.events.set(['email.received']);
      component.description.set('a'.repeat(501));
      expect(component.isValid()).toBeFalse();
    });

    it('returns true for valid form', () => {
      component.url.set('https://example.com');
      component.events.set(['email.received']);
      component.description.set('Valid description');
      expect(component.isValid()).toBeTrue();
    });
  });

  describe('onEventToggle', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('adds event when checked', () => {
      component.events.set(['email.received']);
      component.onEventToggle('email.stored', true);
      expect(component.events()).toContain('email.stored');
    });

    it('does not duplicate event', () => {
      component.events.set(['email.received']);
      component.onEventToggle('email.received', true);
      expect(component.events().filter((e) => e === 'email.received').length).toBe(1);
    });

    it('removes event when unchecked', () => {
      component.events.set(['email.received', 'email.stored']);
      component.onEventToggle('email.stored', false);
      expect(component.events()).not.toContain('email.stored');
    });
  });

  describe('isEventChecked', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('returns true if event is in list', () => {
      component.events.set(['email.received']);
      expect(component.isEventChecked('email.received')).toBeTrue();
    });

    it('returns false if event is not in list', () => {
      component.events.set(['email.received']);
      expect(component.isEventChecked('email.stored')).toBeFalse();
    });
  });

  describe('onSave', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('does nothing if form is invalid', async () => {
      component.url.set('');

      await component.onSave();

      expect(webhookServiceStub.create).not.toHaveBeenCalled();
      expect(webhookServiceStub.update).not.toHaveBeenCalled();
    });

    it('creates webhook in create mode', async () => {
      componentRef.setInput('webhook', null);
      component.url.set('https://example.com');
      component.events.set(['email.received']);
      component.description.set('Test');

      const createdWebhook = createWebhook();
      webhookServiceStub.create.and.returnValue(of(createdWebhook));
      const savedSpy = spyOn(component.saved, 'emit');
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');

      await component.onSave();

      expect(webhookServiceStub.create).toHaveBeenCalledWith(
        globalScope,
        jasmine.objectContaining({
          url: 'https://example.com',
          events: ['email.received'],
          description: 'Test',
        }),
      );
      expect(savedSpy).toHaveBeenCalledWith(createdWebhook);
      expect(showSuccessSpy).toHaveBeenCalledWith('Webhook Created', 'New webhook has been created successfully');
    });

    it('updates webhook in edit mode', async () => {
      const webhook = createWebhook();
      componentRef.setInput('webhook', webhook);
      fixture.detectChanges();

      component.url.set('https://updated.com');

      const updatedWebhook = createWebhook({ url: 'https://updated.com' });
      webhookServiceStub.update.and.returnValue(of(updatedWebhook));
      const savedSpy = spyOn(component.saved, 'emit');
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');

      await component.onSave();

      expect(webhookServiceStub.update).toHaveBeenCalledWith(
        globalScope,
        'webhook-1',
        jasmine.objectContaining({
          url: 'https://updated.com',
        }),
      );
      expect(savedSpy).toHaveBeenCalledWith(updatedWebhook);
      expect(showSuccessSpy).toHaveBeenCalledWith('Webhook Updated', 'Webhook has been updated successfully');
    });

    it('includes custom template in DTO', async () => {
      componentRef.setInput('webhook', null);
      component.url.set('https://example.com');
      component.events.set(['email.received']);
      component.templateType.set('custom');
      component.customTemplateBody.set('{"text": "test"}');
      component.customContentType.set('text/plain');

      webhookServiceStub.create.and.returnValue(of(createWebhook()));

      await component.onSave();

      expect(webhookServiceStub.create).toHaveBeenCalledWith(
        globalScope,
        jasmine.objectContaining({
          template: {
            type: 'custom',
            body: '{"text": "test"}',
            contentType: 'text/plain',
          },
        }),
      );
    });

    it('defaults contentType to application/json when empty', async () => {
      componentRef.setInput('webhook', null);
      component.url.set('https://example.com');
      component.events.set(['email.received']);
      component.templateType.set('custom');
      component.customTemplateBody.set('{"text": "test"}');
      component.customContentType.set('   ');

      webhookServiceStub.create.and.returnValue(of(createWebhook()));

      await component.onSave();

      expect(webhookServiceStub.create).toHaveBeenCalledWith(
        globalScope,
        jasmine.objectContaining({
          template: {
            type: 'custom',
            body: '{"text": "test"}',
            contentType: 'application/json',
          },
        }),
      );
    });

    it('includes built-in template type in DTO', async () => {
      componentRef.setInput('webhook', null);
      component.url.set('https://example.com');
      component.events.set(['email.received']);
      component.templateType.set('slack');

      webhookServiceStub.create.and.returnValue(of(createWebhook()));

      await component.onSave();

      expect(webhookServiceStub.create).toHaveBeenCalledWith(
        globalScope,
        jasmine.objectContaining({
          template: 'slack',
        }),
      );
    });

    it('includes filter in DTO when enabled with rules', async () => {
      componentRef.setInput('webhook', null);
      component.url.set('https://example.com');
      component.events.set(['email.received']);
      component.filterEnabled.set(true);
      component.filterConfig.set({
        rules: [{ field: 'subject', operator: 'contains', value: 'test' }],
        mode: 'all',
      });

      webhookServiceStub.create.and.returnValue(of(createWebhook()));

      await component.onSave();

      expect(webhookServiceStub.create).toHaveBeenCalledWith(
        globalScope,
        jasmine.objectContaining({
          filter: {
            rules: [{ field: 'subject', operator: 'contains', value: 'test' }],
            mode: 'all',
          },
        }),
      );
    });

    it('shows error toast on failure', async () => {
      componentRef.setInput('webhook', null);
      component.url.set('https://example.com');
      component.events.set(['email.received']);

      webhookServiceStub.create.and.returnValue(
        throwError(() => ({
          error: { message: 'URL is not reachable' },
        })),
      );
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.onSave();

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'URL is not reachable');
    });

    it('handles array error messages', async () => {
      componentRef.setInput('webhook', null);
      component.url.set('https://example.com');
      component.events.set(['email.received']);

      webhookServiceStub.create.and.returnValue(
        throwError(() => ({
          error: { message: ['Error 1', 'Error 2'] },
        })),
      );
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.onSave();

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Error 1, Error 2');
    });
  });

  describe('copySecret', () => {
    let writeTextSpy: jasmine.Spy;

    beforeEach(() => {
      // Handle case where clipboard.writeText may already be spied by another test suite
      const existingSpy = navigator.clipboard.writeText as jasmine.Spy;
      if (existingSpy && typeof existingSpy.and === 'object') {
        writeTextSpy = existingSpy;
      } else {
        writeTextSpy = spyOn(navigator.clipboard, 'writeText');
      }
      writeTextSpy.calls.reset();
      writeTextSpy.and.returnValue(Promise.resolve());
      componentRef.setInput('webhook', createWebhook({ secret: 'test-secret' }));
      fixture.detectChanges();
    });

    it('copies secret to clipboard', async () => {
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');

      component.copySecret();

      expect(writeTextSpy).toHaveBeenCalledWith('test-secret');
      expect(showSuccessSpy).toHaveBeenCalledWith('Copied', 'Secret copied to clipboard');
    });

    it('does nothing if no secret', () => {
      componentRef.setInput('webhook', createWebhook({ secret: undefined }));
      fixture.detectChanges();

      writeTextSpy.calls.reset();

      component.copySecret();

      expect(writeTextSpy).not.toHaveBeenCalled();
    });
  });

  describe('confirmRotateSecret', () => {
    beforeEach(() => {
      componentRef.setInput('webhook', createWebhook());
      fixture.detectChanges();
    });

    it('shows confirmation dialog', () => {
      component.confirmRotateSecret();

      expect(confirmationServiceStub.confirm).toHaveBeenCalledWith(
        jasmine.objectContaining({
          header: 'Rotate Secret?',
          acceptLabel: 'Rotate Secret',
          rejectLabel: 'Cancel',
        }),
      );
    });

    it('rotates secret when confirmed', async () => {
      const rotateResponse = {
        id: 'webhook-1',
        secret: 'new-secret',
        previousSecretValidUntil: new Date().toISOString(),
      };
      webhookServiceStub.rotateSecret.and.returnValue(of(rotateResponse));
      const savedSpy = spyOn(component.saved, 'emit');
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');

      confirmationServiceStub.confirm.and.callFake((config) => {
        config.accept?.();
        return confirmationServiceStub;
      });

      component.confirmRotateSecret();
      await fixture.whenStable();

      expect(webhookServiceStub.rotateSecret).toHaveBeenCalledWith(globalScope, 'webhook-1');
      expect(savedSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          secret: 'new-secret',
        }),
      );
      expect(showSuccessSpy).toHaveBeenCalled();
    });

    it('shows error toast when rotation fails', async () => {
      webhookServiceStub.rotateSecret.and.returnValue(throwError(() => new Error('Failed')));
      const showErrorSpy = spyOn(toastStub, 'showError');

      confirmationServiceStub.confirm.and.callFake((config) => {
        config.accept?.();
        return confirmationServiceStub;
      });

      component.confirmRotateSecret();
      await fixture.whenStable();

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'An unexpected error occurred');
    });
  });

  describe('onCancel', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('closes dialog', () => {
      const closedSpy = spyOn(component.closed, 'emit');

      component.onCancel();

      expect(closedSpy).toHaveBeenCalled();
    });
  });
});
