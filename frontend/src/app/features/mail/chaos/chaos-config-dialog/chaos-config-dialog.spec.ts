import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, ComponentRef } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { ChaosConfigDialog } from './chaos-config-dialog';
import { ChaosService } from '../services/chaos.service';
import { VsToast } from '../../../../shared/services/vs-toast';
import { VsToastStub } from '../../../../../testing/mail-testing.mocks';
import { ChaosConfigResponse } from '../interfaces/chaos.interfaces';
import { InboxModel } from '../../interfaces';

describe('ChaosConfigDialog', () => {
  let component: ChaosConfigDialog;
  let componentRef: ComponentRef<ChaosConfigDialog>;
  let fixture: ComponentFixture<ChaosConfigDialog>;
  let chaosServiceStub: jasmine.SpyObj<ChaosService>;
  let toastStub: VsToastStub;
  let confirmationServiceStub: jasmine.SpyObj<ConfirmationService>;

  const createInbox = (overrides: Partial<InboxModel> = {}): InboxModel => ({
    emailAddress: 'test@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'test-hash',
    encrypted: true,
    emailAuth: true,
    serverSigPk: 'test-pk',
    secretKey: new Uint8Array(),
    emails: [],
    ...overrides,
  });

  const createChaosConfig = (overrides: Partial<ChaosConfigResponse> = {}): ChaosConfigResponse => ({
    enabled: false,
    ...overrides,
  });

  beforeEach(async () => {
    chaosServiceStub = jasmine.createSpyObj('ChaosService', ['get', 'set', 'disable']);
    toastStub = new VsToastStub();
    confirmationServiceStub = jasmine.createSpyObj('ConfirmationService', ['confirm']);

    chaosServiceStub.get.and.returnValue(of(createChaosConfig()));

    await TestBed.configureTestingModule({
      imports: [ChaosConfigDialog],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: ChaosService, useValue: chaosServiceStub },
        { provide: VsToast, useValue: toastStub },
        { provide: ConfirmationService, useValue: confirmationServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChaosConfigDialog);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('inbox', createInbox());
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('loads config on init', async () => {
      const config = createChaosConfig({ enabled: true });
      chaosServiceStub.get.and.returnValue(of(config));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(chaosServiceStub.get).toHaveBeenCalledWith('test@example.com');
      expect(component.enabled()).toBeTrue();
    });

    it('sets loading state during fetch', async () => {
      chaosServiceStub.get.and.returnValue(of(createChaosConfig()));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.loading()).toBeFalse();
    });
  });

  describe('loadConfig', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('sets error message on failure (non-404)', async () => {
      chaosServiceStub.get.and.returnValue(throwError(() => ({ status: 500 })));
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.loadConfig();

      expect(component.error()).toBe('Failed to load chaos configuration');
      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Failed to load chaos configuration');
    });

    it('does not set error on 404 (no config exists)', async () => {
      chaosServiceStub.get.and.returnValue(throwError(() => ({ status: 404 })));
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.loadConfig();

      expect(component.error()).toBeNull();
      expect(showErrorSpy).not.toHaveBeenCalled();
    });

    it('clears error on successful load', async () => {
      component.error.set('Previous error');
      chaosServiceStub.get.and.returnValue(of(createChaosConfig()));

      await component.loadConfig();

      expect(component.error()).toBeNull();
    });

    it('applies full config to form', async () => {
      const config = createChaosConfig({
        enabled: true,
        expiresAt: '2024-12-31T23:59:59Z',
        latency: { enabled: true, minDelayMs: 200, maxDelayMs: 800, jitter: false, probability: 0.5 },
        connectionDrop: { enabled: true, probability: 0.3, graceful: false },
        randomError: { enabled: true, errorRate: 0.2, errorTypes: ['permanent'] },
        greylist: { enabled: true, retryWindowMs: 60000, maxAttempts: 3, trackBy: 'sender' },
        blackhole: { enabled: true, triggerWebhooks: true },
      });
      chaosServiceStub.get.and.returnValue(of(config));

      await component.loadConfig();

      expect(component.enabled()).toBeTrue();
      expect(component.expiresAt()).toEqual(new Date('2024-12-31T23:59:59Z'));

      expect(component.latencyEnabled()).toBeTrue();
      expect(component.latencyMinDelayMs()).toBe(200);
      expect(component.latencyMaxDelayMs()).toBe(800);
      expect(component.latencyJitter()).toBeFalse();
      expect(component.latencyProbability()).toBe(50);

      expect(component.connectionDropEnabled()).toBeTrue();
      expect(component.connectionDropProbability()).toBe(30);
      expect(component.connectionDropGraceful()).toBeFalse();

      expect(component.randomErrorEnabled()).toBeTrue();
      expect(component.randomErrorRate()).toBe(20);
      expect(component.randomErrorTypes()).toEqual(['permanent']);

      expect(component.greylistEnabled()).toBeTrue();
      expect(component.greylistRetryWindowMs()).toBe(60000);
      expect(component.greylistMaxAttempts()).toBe(3);
      expect(component.greylistTrackBy()).toBe('sender');

      expect(component.blackholeEnabled()).toBeTrue();
      expect(component.blackholeTriggerWebhooks()).toBeTrue();
    });

    it('applies config with missing optional fields using defaults', async () => {
      const config = createChaosConfig({
        enabled: true,
        latency: { enabled: true },
        connectionDrop: { enabled: true },
        randomError: { enabled: true },
        greylist: { enabled: true },
        blackhole: { enabled: true },
      });
      chaosServiceStub.get.and.returnValue(of(config));

      await component.loadConfig();

      expect(component.latencyMinDelayMs()).toBe(500);
      expect(component.latencyMaxDelayMs()).toBe(10000);
      expect(component.latencyJitter()).toBeTrue();
      expect(component.latencyProbability()).toBe(100);

      expect(component.connectionDropProbability()).toBe(100);
      expect(component.connectionDropGraceful()).toBeTrue();

      expect(component.randomErrorRate()).toBe(10);
      expect(component.randomErrorTypes()).toEqual(['temporary']);

      expect(component.greylistRetryWindowMs()).toBe(300000);
      expect(component.greylistMaxAttempts()).toBe(2);
      expect(component.greylistTrackBy()).toBe('ip_sender');

      expect(component.blackholeTriggerWebhooks()).toBeFalse();
    });

    it('handles null expiresAt', async () => {
      const config = createChaosConfig({ enabled: true, expiresAt: undefined });
      chaosServiceStub.get.and.returnValue(of(config));

      await component.loadConfig();

      expect(component.expiresAt()).toBeNull();
    });
  });

  describe('saveConfig', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('builds config from form and saves', async () => {
      component.enabled.set(true);
      chaosServiceStub.set.and.returnValue(of(createChaosConfig({ enabled: true })));
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');
      const closedSpy = spyOn(component.closed, 'emit');
      const statusChangedSpy = spyOn(component.statusChanged, 'emit');

      await component.saveConfig();

      expect(chaosServiceStub.set).toHaveBeenCalledWith(
        'test@example.com',
        jasmine.objectContaining({ enabled: true }),
      );
      expect(showSuccessSpy).toHaveBeenCalledWith('Saved', 'Chaos configuration saved');
      expect(statusChangedSpy).toHaveBeenCalledWith(true);
      expect(closedSpy).toHaveBeenCalled();
    });

    it('sets saving state during save', async () => {
      chaosServiceStub.set.and.returnValue(of(createChaosConfig()));

      await component.saveConfig();

      expect(component.saving()).toBeFalse();
    });

    it('shows error toast on save failure', async () => {
      chaosServiceStub.set.and.returnValue(throwError(() => new Error('Save failed')));
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.saveConfig();

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Failed to save chaos configuration');
    });

    it('includes expiresAt when set', async () => {
      const expiresAt = new Date('2024-12-31T23:59:59Z');
      component.enabled.set(true);
      component.expiresAt.set(expiresAt);
      chaosServiceStub.set.and.returnValue(of(createChaosConfig()));

      await component.saveConfig();

      expect(chaosServiceStub.set).toHaveBeenCalledWith(
        'test@example.com',
        jasmine.objectContaining({ expiresAt: expiresAt.toISOString() }),
      );
    });

    it('includes latency config when enabled', async () => {
      component.enabled.set(true);
      component.latencyEnabled.set(true);
      component.latencyMinDelayMs.set(100);
      component.latencyMaxDelayMs.set(500);
      component.latencyJitter.set(false);
      component.latencyProbability.set(50);
      chaosServiceStub.set.and.returnValue(of(createChaosConfig()));

      await component.saveConfig();

      expect(chaosServiceStub.set).toHaveBeenCalledWith(
        'test@example.com',
        jasmine.objectContaining({
          latency: {
            enabled: true,
            minDelayMs: 100,
            maxDelayMs: 500,
            jitter: false,
            probability: 0.5,
          },
        }),
      );
    });

    it('includes connectionDrop config when enabled', async () => {
      component.enabled.set(true);
      component.connectionDropEnabled.set(true);
      component.connectionDropProbability.set(30);
      component.connectionDropGraceful.set(false);
      chaosServiceStub.set.and.returnValue(of(createChaosConfig()));

      await component.saveConfig();

      expect(chaosServiceStub.set).toHaveBeenCalledWith(
        'test@example.com',
        jasmine.objectContaining({
          connectionDrop: {
            enabled: true,
            probability: 0.3,
            graceful: false,
          },
        }),
      );
    });

    it('includes randomError config when enabled', async () => {
      component.enabled.set(true);
      component.randomErrorEnabled.set(true);
      component.randomErrorRate.set(25);
      component.randomErrorTypes.set(['temporary', 'permanent']);
      chaosServiceStub.set.and.returnValue(of(createChaosConfig()));

      await component.saveConfig();

      expect(chaosServiceStub.set).toHaveBeenCalledWith(
        'test@example.com',
        jasmine.objectContaining({
          randomError: {
            enabled: true,
            errorRate: 0.25,
            errorTypes: ['temporary', 'permanent'],
          },
        }),
      );
    });

    it('includes greylist config when enabled', async () => {
      component.enabled.set(true);
      component.greylistEnabled.set(true);
      component.greylistRetryWindowMs.set(120000);
      component.greylistMaxAttempts.set(5);
      component.greylistTrackBy.set('ip');
      chaosServiceStub.set.and.returnValue(of(createChaosConfig()));

      await component.saveConfig();

      expect(chaosServiceStub.set).toHaveBeenCalledWith(
        'test@example.com',
        jasmine.objectContaining({
          greylist: {
            enabled: true,
            retryWindowMs: 120000,
            maxAttempts: 5,
            trackBy: 'ip',
          },
        }),
      );
    });

    it('includes blackhole config when enabled', async () => {
      component.enabled.set(true);
      component.blackholeEnabled.set(true);
      component.blackholeTriggerWebhooks.set(true);
      chaosServiceStub.set.and.returnValue(of(createChaosConfig()));

      await component.saveConfig();

      expect(chaosServiceStub.set).toHaveBeenCalledWith(
        'test@example.com',
        jasmine.objectContaining({
          blackhole: {
            enabled: true,
            triggerWebhooks: true,
          },
        }),
      );
    });

    it('does not include disabled chaos types in config', async () => {
      component.enabled.set(true);
      component.latencyEnabled.set(false);
      component.connectionDropEnabled.set(false);
      component.randomErrorEnabled.set(false);
      component.greylistEnabled.set(false);
      component.blackholeEnabled.set(false);
      chaosServiceStub.set.and.returnValue(of(createChaosConfig()));

      await component.saveConfig();

      const callArgs = chaosServiceStub.set.calls.mostRecent().args[1];
      expect(callArgs.latency).toBeUndefined();
      expect(callArgs.connectionDrop).toBeUndefined();
      expect(callArgs.randomError).toBeUndefined();
      expect(callArgs.greylist).toBeUndefined();
      expect(callArgs.blackhole).toBeUndefined();
    });
  });

  describe('confirmDisableAll', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('shows confirmation dialog', () => {
      component.confirmDisableAll();

      expect(confirmationServiceStub.confirm).toHaveBeenCalledWith(
        jasmine.objectContaining({
          header: 'Disable All Chaos?',
          acceptLabel: 'Disable All',
          rejectLabel: 'Cancel',
        }),
      );
    });

    it('disables all chaos when confirmed', async () => {
      chaosServiceStub.disable.and.returnValue(of(void 0));
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');
      const closedSpy = spyOn(component.closed, 'emit');
      const statusChangedSpy = spyOn(component.statusChanged, 'emit');

      let acceptPromise: Promise<void> | undefined;
      confirmationServiceStub.confirm.and.callFake((config) => {
        acceptPromise = config.accept?.() as Promise<void>;
        return confirmationServiceStub;
      });

      component.confirmDisableAll();
      await acceptPromise;
      await fixture.whenStable();

      expect(chaosServiceStub.disable).toHaveBeenCalledWith('test@example.com');
      expect(showSuccessSpy).toHaveBeenCalledWith('Disabled', 'All chaos has been disabled');
      expect(statusChangedSpy).toHaveBeenCalledWith(false);
      expect(closedSpy).toHaveBeenCalled();
    });

    it('shows error toast when disable fails', async () => {
      chaosServiceStub.disable.and.returnValue(throwError(() => new Error('Disable failed')));
      const showErrorSpy = spyOn(toastStub, 'showError');

      confirmationServiceStub.confirm.and.callFake((config) => {
        config.accept?.();
        return confirmationServiceStub;
      });

      component.confirmDisableAll();
      await fixture.whenStable();

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Failed to disable chaos');
    });

    it('sets saving state during disable', async () => {
      chaosServiceStub.disable.and.returnValue(of(void 0));

      confirmationServiceStub.confirm.and.callFake((config) => {
        config.accept?.();
        return confirmationServiceStub;
      });

      component.confirmDisableAll();
      await fixture.whenStable();

      expect(component.saving()).toBeFalse();
    });
  });

  describe('cancel', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('closes the dialog', () => {
      const closedSpy = spyOn(component.closed, 'emit');

      component.cancel();

      expect(component.dialogVisible).toBeFalse();
      expect(closedSpy).toHaveBeenCalled();
    });
  });

  describe('formatMs', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('formats milliseconds less than 1000 as ms', () => {
      expect(component.formatMs(500)).toBe('500ms');
      expect(component.formatMs(999)).toBe('999ms');
    });

    it('formats 1000-59999 milliseconds as seconds', () => {
      expect(component.formatMs(1000)).toBe('1s');
      expect(component.formatMs(5000)).toBe('5s');
      expect(component.formatMs(30000)).toBe('30s');
    });

    it('formats 60000+ milliseconds as minutes', () => {
      expect(component.formatMs(60000)).toBe('1m');
      expect(component.formatMs(300000)).toBe('5m');
      expect(component.formatMs(600000)).toBe('10m');
    });
  });

  describe('select options', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('has error type options for random error', () => {
      expect(component.errorTypeOptions).toEqual([
        { label: 'Temporary (4xx)', value: 'temporary' },
        { label: 'Permanent (5xx)', value: 'permanent' },
      ]);
    });

    it('has track by options for greylist', () => {
      expect(component.trackByOptions).toEqual([
        { label: 'IP Address', value: 'ip' },
        { label: 'Sender Email', value: 'sender' },
        { label: 'IP + Sender', value: 'ip_sender' },
      ]);
    });
  });

  describe('syncGlobalEnabled effect', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('auto-enables global enabled when a chaos type is enabled', async () => {
      expect(component.enabled()).toBeFalse();

      component.latencyEnabled.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.enabled()).toBeTrue();
    });

    it('auto-disables global enabled when all chaos types are disabled', async () => {
      // First enable a chaos type to set enabled to true
      component.connectionDropEnabled.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.enabled()).toBeTrue();

      // Now disable it
      component.connectionDropEnabled.set(false);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.enabled()).toBeFalse();
    });
  });

  describe('minExpirationDate', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('is set to current date', () => {
      const now = new Date();
      expect(component.minExpirationDate.getFullYear()).toBe(now.getFullYear());
      expect(component.minExpirationDate.getMonth()).toBe(now.getMonth());
      expect(component.minExpirationDate.getDate()).toBe(now.getDate());
    });
  });
});
