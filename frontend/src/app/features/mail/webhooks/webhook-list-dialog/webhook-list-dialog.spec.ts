import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, ComponentRef } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { WebhookListDialog } from './webhook-list-dialog';
import { WebhookService } from '../services/webhook.service';
import { VsToast } from '../../../../shared/services/vs-toast';
import { WebhookResponse, WebhookScope, TestWebhookResponse } from '../interfaces/webhook.interfaces';
import { VsToastStub } from '../../../../../testing/mail-testing.mocks';

describe('WebhookListDialog', () => {
  let component: WebhookListDialog;
  let componentRef: ComponentRef<WebhookListDialog>;
  let fixture: ComponentFixture<WebhookListDialog>;
  let webhookServiceStub: jasmine.SpyObj<WebhookService>;
  let toastStub: VsToastStub;
  let confirmationServiceStub: jasmine.SpyObj<ConfirmationService>;

  const createWebhook = (overrides: Partial<WebhookResponse> = {}): WebhookResponse => ({
    id: 'webhook-1',
    url: 'https://example.com/webhook',
    events: ['email.received'],
    scope: 'global',
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  const globalScope: WebhookScope = { type: 'global' };
  const inboxScope: WebhookScope = { type: 'inbox', email: 'test@example.com' };

  beforeEach(async () => {
    webhookServiceStub = jasmine.createSpyObj('WebhookService', ['list', 'update', 'delete', 'test']);
    toastStub = new VsToastStub();
    confirmationServiceStub = jasmine.createSpyObj('ConfirmationService', ['confirm']);

    webhookServiceStub.list.and.returnValue(of({ webhooks: [], total: 0 }));

    await TestBed.configureTestingModule({
      imports: [WebhookListDialog],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: WebhookService, useValue: webhookServiceStub },
        { provide: VsToast, useValue: toastStub },
        { provide: ConfirmationService, useValue: confirmationServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WebhookListDialog);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('scope', globalScope);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('loads webhooks on init', async () => {
      const webhooks = [createWebhook()];
      webhookServiceStub.list.and.returnValue(of({ webhooks, total: 1 }));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(webhookServiceStub.list).toHaveBeenCalledWith(globalScope);
      expect(component.webhooks()).toEqual(webhooks);
    });

    it('sets loading state during fetch', async () => {
      webhookServiceStub.list.and.returnValue(of({ webhooks: [], total: 0 }));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.loading()).toBeFalse();
    });
  });

  describe('loadWebhooks', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('sets error message on failure', async () => {
      webhookServiceStub.list.and.returnValue(throwError(() => new Error('Network error')));
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.loadWebhooks();

      expect(component.error()).toBe('Failed to load webhooks');
      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Failed to load webhooks');
    });

    it('clears error on successful load', async () => {
      webhookServiceStub.list.and.returnValue(of({ webhooks: [], total: 0 }));

      await component.loadWebhooks();

      expect(component.error()).toBeNull();
    });
  });

  describe('computed scopeTitle', () => {
    it('returns "Global" for global scope', () => {
      componentRef.setInput('scope', globalScope);
      fixture.detectChanges();

      expect(component.scopeTitle()).toBe('Global');
    });

    it('returns inbox email for inbox scope', () => {
      componentRef.setInput('scope', inboxScope);
      fixture.detectChanges();

      expect(component.scopeTitle()).toBe('Inbox: test@example.com');
    });
  });

  describe('computed dialogTitle', () => {
    it('returns "Global Webhooks" for global scope', () => {
      componentRef.setInput('scope', globalScope);
      fixture.detectChanges();

      expect(component.dialogTitle()).toBe('Global Webhooks');
    });

    it('returns "Inbox Webhooks" for inbox scope', () => {
      componentRef.setInput('scope', inboxScope);
      fixture.detectChanges();

      expect(component.dialogTitle()).toBe('Inbox Webhooks');
    });
  });

  describe('openCreateDialog', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('sets editingWebhook to null and opens edit dialog', () => {
      component.openCreateDialog();

      expect(component.editingWebhook()).toBeNull();
      expect(component.editDialogVisible()).toBeTrue();
    });
  });

  describe('openEditDialog', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('sets editingWebhook and opens edit dialog', () => {
      const webhook = createWebhook();

      component.openEditDialog(webhook);

      expect(component.editingWebhook()).toEqual(webhook);
      expect(component.editDialogVisible()).toBeTrue();
    });
  });

  describe('onEditDialogClosed', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('closes edit dialog and clears editing webhook', () => {
      component.editDialogVisible.set(true);
      component.editingWebhook.set(createWebhook());

      component.onEditDialogClosed();

      expect(component.editDialogVisible()).toBeFalse();
      expect(component.editingWebhook()).toBeNull();
    });
  });

  describe('onWebhookSaved', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('updates existing webhook in list', () => {
      const webhook = createWebhook({ id: 'webhook-1', url: 'https://old.com' });
      component.webhooks.set([webhook]);
      component.editDialogVisible.set(true);

      const updatedWebhook = createWebhook({ id: 'webhook-1', url: 'https://new.com' });
      component.onWebhookSaved(updatedWebhook);

      expect(component.webhooks()).toEqual([updatedWebhook]);
      expect(component.editDialogVisible()).toBeFalse();
    });

    it('adds new webhook to beginning of list', () => {
      const existingWebhook = createWebhook({ id: 'webhook-1' });
      component.webhooks.set([existingWebhook]);
      component.editDialogVisible.set(true);

      const newWebhook = createWebhook({ id: 'webhook-2' });
      component.onWebhookSaved(newWebhook);

      expect(component.webhooks()).toEqual([newWebhook, existingWebhook]);
      expect(component.editDialogVisible()).toBeFalse();
    });
  });

  describe('toggleEnabled', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('updates webhook enabled state to disabled', async () => {
      const webhook = createWebhook({ enabled: true });
      const updatedWebhook = createWebhook({ enabled: false });
      component.webhooks.set([webhook]);
      webhookServiceStub.update.and.returnValue(of(updatedWebhook));
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');

      await component.toggleEnabled(webhook);

      expect(webhookServiceStub.update).toHaveBeenCalledWith(globalScope, 'webhook-1', { enabled: false });
      expect(component.webhooks()[0].enabled).toBeFalse();
      expect(showSuccessSpy).toHaveBeenCalledWith('Webhook Updated', 'Webhook disabled');
    });

    it('updates webhook enabled state to enabled', async () => {
      const webhook = createWebhook({ enabled: false });
      const updatedWebhook = createWebhook({ enabled: true });
      component.webhooks.set([webhook]);
      webhookServiceStub.update.and.returnValue(of(updatedWebhook));
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');

      await component.toggleEnabled(webhook);

      expect(webhookServiceStub.update).toHaveBeenCalledWith(globalScope, 'webhook-1', { enabled: true });
      expect(component.webhooks()[0].enabled).toBeTrue();
      expect(showSuccessSpy).toHaveBeenCalledWith('Webhook Updated', 'Webhook enabled');
    });

    it('shows error toast on failure', async () => {
      const webhook = createWebhook({ enabled: true });
      component.webhooks.set([webhook]);
      webhookServiceStub.update.and.returnValue(throwError(() => new Error('Failed')));
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.toggleEnabled(webhook);

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Failed to update webhook');
    });
  });

  describe('testWebhook', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('shows test result dialog on success', async () => {
      const webhook = createWebhook();
      const testResult: TestWebhookResponse = { success: true, statusCode: 200 };
      webhookServiceStub.test.and.returnValue(of(testResult));

      await component.testWebhook(webhook);

      expect(webhookServiceStub.test).toHaveBeenCalledWith(globalScope, 'webhook-1');
      expect(component.testResult()).toEqual(testResult);
      expect(component.testResultDialogVisible()).toBeTrue();
    });

    it('sets and clears testingWebhookId during test', async () => {
      const webhook = createWebhook();
      webhookServiceStub.test.and.returnValue(of({ success: true }));

      await component.testWebhook(webhook);

      expect(component.testingWebhookId()).toBeNull();
    });

    it('shows error toast on failure', async () => {
      const webhook = createWebhook();
      webhookServiceStub.test.and.returnValue(throwError(() => new Error('Failed')));
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.testWebhook(webhook);

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Failed to test webhook');
    });
  });

  describe('onTestResultDialogClosed', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('closes dialog and clears test result', () => {
      component.testResultDialogVisible.set(true);
      component.testResult.set({ success: true });

      component.onTestResultDialogClosed();

      expect(component.testResultDialogVisible()).toBeFalse();
      expect(component.testResult()).toBeNull();
    });
  });

  describe('confirmDelete', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('shows confirmation dialog', () => {
      const webhook = createWebhook();

      component.confirmDelete(webhook);

      expect(confirmationServiceStub.confirm).toHaveBeenCalledWith(
        jasmine.objectContaining({
          header: 'Delete Webhook?',
          acceptLabel: 'Delete',
          rejectLabel: 'Cancel',
        }),
      );
    });

    it('deletes webhook when confirmed', async () => {
      const webhook1 = createWebhook({ id: 'webhook-1' });
      const webhook2 = createWebhook({ id: 'webhook-2' });
      // Wait for ngOnInit's loadWebhooks to complete before setting webhooks
      await fixture.whenStable();
      component.webhooks.set([webhook1, webhook2]);
      webhookServiceStub.delete.and.returnValue(of(void 0));
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');

      let acceptPromise: Promise<void> | undefined;
      confirmationServiceStub.confirm.and.callFake((config) => {
        acceptPromise = config.accept?.() as Promise<void>;
        return confirmationServiceStub;
      });

      component.confirmDelete(webhook1);
      await acceptPromise;
      await fixture.whenStable();

      expect(webhookServiceStub.delete).toHaveBeenCalledWith(globalScope, 'webhook-1');
      expect(component.webhooks()).toEqual([webhook2]);
      expect(showSuccessSpy).toHaveBeenCalledWith('Webhook Deleted', 'Webhook has been deleted successfully');
    });

    it('shows error toast when delete fails', async () => {
      const webhook = createWebhook();
      component.webhooks.set([webhook]);
      webhookServiceStub.delete.and.returnValue(throwError(() => new Error('Failed')));
      const showErrorSpy = spyOn(toastStub, 'showError');

      confirmationServiceStub.confirm.and.callFake((config) => {
        config.accept?.();
        return confirmationServiceStub;
      });

      component.confirmDelete(webhook);
      await fixture.whenStable();

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Failed to delete webhook');
    });
  });

  describe('truncateUrl', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('returns original url if within max length', () => {
      const shortUrl = 'https://example.com';
      expect(component.truncateUrl(shortUrl, 40)).toBe(shortUrl);
    });

    it('truncates url if exceeds max length', () => {
      const longUrl = 'https://example.com/very/long/path/that/exceeds/the/maximum/length';
      const result = component.truncateUrl(longUrl, 40);

      expect(result.length).toBe(40);
      expect(result.endsWith('...')).toBeTrue();
    });
  });

  describe('formatTimeAgo', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('returns "Never" for undefined date', () => {
      expect(component.formatTimeAgo(undefined)).toBe('Never');
    });

    it('returns "Just now" for recent dates', () => {
      const now = new Date().toISOString();
      expect(component.formatTimeAgo(now)).toBe('Just now');
    });

    it('returns minutes ago for dates within an hour', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(component.formatTimeAgo(fiveMinutesAgo)).toBe('5m ago');
    });

    it('returns hours ago for dates within a day', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      expect(component.formatTimeAgo(twoHoursAgo)).toBe('2h ago');
    });

    it('returns days ago for dates within a week', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(component.formatTimeAgo(threeDaysAgo)).toBe('3d ago');
    });

    it('returns formatted date for older dates', () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const result = component.formatTimeAgo(twoWeeksAgo.toISOString());

      expect(result).toBe(twoWeeksAgo.toLocaleDateString());
    });
  });

  describe('trackByWebhookId', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('returns webhook id', () => {
      const webhook = createWebhook({ id: 'webhook-123' });
      expect(component.trackByWebhookId(0, webhook)).toBe('webhook-123');
    });
  });
});
