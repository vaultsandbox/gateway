import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { ChaosService } from '../chaos.service';
import { ChaosConfigRequest, ChaosConfigResponse } from '../../interfaces/chaos.interfaces';

describe('ChaosService', () => {
  let service: ChaosService;
  let httpClientStub: jasmine.SpyObj<HttpClient>;

  const createChaosConfig = (overrides: Partial<ChaosConfigResponse> = {}): ChaosConfigResponse => ({
    enabled: true,
    ...overrides,
  });

  beforeEach(() => {
    httpClientStub = jasmine.createSpyObj('HttpClient', ['get', 'post', 'delete']);

    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ChaosService, { provide: HttpClient, useValue: httpClientStub }],
    });

    service = TestBed.inject(ChaosService);
  });

  describe('get', () => {
    it('calls GET /inboxes/:email/chaos endpoint with encoded email', () => {
      const config = createChaosConfig();
      httpClientStub.get.and.returnValue(of(config));

      service.get('test@example.com').subscribe((result) => {
        expect(result).toEqual(config);
      });

      expect(httpClientStub.get).toHaveBeenCalledWith(jasmine.stringMatching(/\/inboxes\/test%40example\.com\/chaos$/));
    });

    it('encodes special characters in email address', () => {
      httpClientStub.get.and.returnValue(of(createChaosConfig()));

      service.get('user+test@example.com').subscribe();

      expect(httpClientStub.get).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/user%2Btest%40example\.com\/chaos$/),
      );
    });

    it('returns chaos configuration with all properties', () => {
      const config = createChaosConfig({
        enabled: true,
        expiresAt: '2024-12-31T23:59:59Z',
        latency: { enabled: true, minDelayMs: 100, maxDelayMs: 500, jitter: true, probability: 0.5 },
        connectionDrop: { enabled: true, probability: 0.3, graceful: false },
        randomError: { enabled: true, errorRate: 0.2, errorTypes: ['temporary', 'permanent'] },
        greylist: { enabled: true, retryWindowMs: 60000, maxAttempts: 3, trackBy: 'ip' },
        blackhole: { enabled: true, triggerWebhooks: true },
      });
      httpClientStub.get.and.returnValue(of(config));

      service.get('test@example.com').subscribe((result) => {
        expect(result.enabled).toBeTrue();
        expect(result.expiresAt).toBe('2024-12-31T23:59:59Z');
        expect(result.latency?.enabled).toBeTrue();
        expect(result.connectionDrop?.enabled).toBeTrue();
        expect(result.randomError?.enabled).toBeTrue();
        expect(result.greylist?.enabled).toBeTrue();
        expect(result.blackhole?.enabled).toBeTrue();
      });
    });
  });

  describe('set', () => {
    it('calls POST /inboxes/:email/chaos endpoint with config', () => {
      const request: ChaosConfigRequest = { enabled: true };
      const response = createChaosConfig();
      httpClientStub.post.and.returnValue(of(response));

      service.set('test@example.com', request).subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/chaos$/),
        request,
      );
    });

    it('encodes special characters in email address', () => {
      const request: ChaosConfigRequest = { enabled: true };
      httpClientStub.post.and.returnValue(of(createChaosConfig()));

      service.set('user+test@example.com', request).subscribe();

      expect(httpClientStub.post).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/user%2Btest%40example\.com\/chaos$/),
        request,
      );
    });

    it('sends full chaos configuration with all options', () => {
      const request: ChaosConfigRequest = {
        enabled: true,
        expiresAt: '2024-12-31T23:59:59Z',
        latency: { enabled: true, minDelayMs: 100, maxDelayMs: 500, jitter: true, probability: 0.5 },
        connectionDrop: { enabled: true, probability: 0.3, graceful: false },
        randomError: { enabled: true, errorRate: 0.2, errorTypes: ['permanent'] },
        greylist: { enabled: true, retryWindowMs: 60000, maxAttempts: 3, trackBy: 'sender' },
        blackhole: { enabled: true, triggerWebhooks: true },
      };
      const response = createChaosConfig(request);
      httpClientStub.post.and.returnValue(of(response));

      service.set('test@example.com', request).subscribe((result) => {
        expect(result).toEqual(response);
      });

      expect(httpClientStub.post).toHaveBeenCalledWith(jasmine.any(String), request);
    });
  });

  describe('disable', () => {
    it('calls DELETE /inboxes/:email/chaos endpoint', () => {
      httpClientStub.delete.and.returnValue(of(void 0));

      service.disable('test@example.com').subscribe();

      expect(httpClientStub.delete).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/test%40example\.com\/chaos$/),
      );
    });

    it('encodes special characters in email address', () => {
      httpClientStub.delete.and.returnValue(of(void 0));

      service.disable('user+test@example.com').subscribe();

      expect(httpClientStub.delete).toHaveBeenCalledWith(
        jasmine.stringMatching(/\/inboxes\/user%2Btest%40example\.com\/chaos$/),
      );
    });

    it('returns void observable when successful', () => {
      httpClientStub.delete.and.returnValue(of(void 0));
      let completed = false;

      service.disable('test@example.com').subscribe({
        complete: () => {
          completed = true;
        },
      });

      expect(completed).toBeTrue();
    });
  });
});
