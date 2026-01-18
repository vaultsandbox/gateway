import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, ComponentRef } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { WebhookTestResultDialog } from './webhook-test-result-dialog';
import { TestWebhookResponse } from '../interfaces/webhook.interfaces';

describe('WebhookTestResultDialog', () => {
  let component: WebhookTestResultDialog;
  let componentRef: ComponentRef<WebhookTestResultDialog>;
  let fixture: ComponentFixture<WebhookTestResultDialog>;

  const createSuccessResult = (overrides: Partial<TestWebhookResponse> = {}): TestWebhookResponse => ({
    success: true,
    statusCode: 200,
    responseTime: 150,
    responseBody: '{"ok": true}',
    payloadSent: { event: 'test', data: { id: '123' } },
    ...overrides,
  });

  const createFailedResult = (overrides: Partial<TestWebhookResponse> = {}): TestWebhookResponse => ({
    success: false,
    statusCode: 500,
    responseTime: 200,
    error: 'Connection refused',
    payloadSent: { event: 'test', data: { id: '123' } },
    ...overrides,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WebhookTestResultDialog],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(WebhookTestResultDialog);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
  });

  it('should create', () => {
    componentRef.setInput('result', createSuccessResult());
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('with success result', () => {
    beforeEach(() => {
      componentRef.setInput('result', createSuccessResult());
      fixture.detectChanges();
    });

    it('displays success result', () => {
      expect(component.result().success).toBeTrue();
      expect(component.result().statusCode).toBe(200);
    });

    it('shows response time', () => {
      expect(component.result().responseTime).toBe(150);
    });
  });

  describe('with failed result', () => {
    beforeEach(() => {
      componentRef.setInput('result', createFailedResult());
      fixture.detectChanges();
    });

    it('displays failed result', () => {
      expect(component.result().success).toBeFalse();
      expect(component.result().error).toBe('Connection refused');
    });

    it('shows status code', () => {
      expect(component.result().statusCode).toBe(500);
    });
  });

  describe('formatPayload', () => {
    it('returns formatted JSON for object payload', () => {
      componentRef.setInput('result', createSuccessResult({ payloadSent: { key: 'value' } }));
      fixture.detectChanges();

      const formatted = component.formatPayload();
      expect(formatted).toBe('{\n  "key": "value"\n}');
    });

    it('returns empty string for undefined payload', () => {
      componentRef.setInput('result', createSuccessResult({ payloadSent: undefined }));
      fixture.detectChanges();

      expect(component.formatPayload()).toBe('');
    });

    it('handles non-JSON payload gracefully', () => {
      const circularObj: Record<string, unknown> = {};
      circularObj['self'] = circularObj;

      componentRef.setInput('result', createSuccessResult({ payloadSent: 'plain string' }));
      fixture.detectChanges();

      const formatted = component.formatPayload();
      expect(formatted).toBe('"plain string"');
    });
  });

  describe('onClose', () => {
    it('emits closed event', () => {
      componentRef.setInput('result', createSuccessResult());
      fixture.detectChanges();

      const closedSpy = spyOn(component.closed, 'emit');

      component.onClose();

      expect(closedSpy).toHaveBeenCalled();
    });
  });
});
