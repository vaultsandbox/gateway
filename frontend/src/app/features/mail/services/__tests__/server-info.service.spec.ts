import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError, Subject } from 'rxjs';

import { ServerInfoService } from '../server-info.service';
import { VaultSandboxApi } from '../vault-sandbox-api';
import { VaultSandbox } from '../../../../shared/services/vault-sandbox';
import { VaultSandboxStub } from '../../../../../testing/mail-testing.mocks';
import { ServerInfo } from '../../interfaces';

describe('ServerInfoService', () => {
  let service: ServerInfoService;
  let vaultSandboxApiSpy: jasmine.SpyObj<VaultSandboxApi>;
  let vaultSandboxStub: VaultSandboxStub;

  const createServerInfo = (): ServerInfo => ({
    serverSigPk: 'test-server-sig-pk',
    algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
    context: 'test-context',
    maxTtl: 86400,
    defaultTtl: 3600,
    sseConsole: false,
    allowClearAllInboxes: true,
    allowedDomains: ['example.com'],
    encryptionPolicy: 'always',
    webhookEnabled: false,
    webhookRequireAuthDefault: true,
    spamAnalysisEnabled: false,
  });

  beforeEach(() => {
    vaultSandboxApiSpy = jasmine.createSpyObj<VaultSandboxApi>('VaultSandboxApi', ['getServerInfo']);
    vaultSandboxStub = new VaultSandboxStub();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ServerInfoService,
        { provide: VaultSandboxApi, useValue: vaultSandboxApiSpy },
        { provide: VaultSandbox, useValue: vaultSandboxStub },
      ],
    });

    service = TestBed.inject(ServerInfoService);
  });

  describe('serverInfo signal', () => {
    it('should initially be null', () => {
      expect(service.serverInfo()).toBeNull();
    });

    it('should be readonly', () => {
      const signal = service.serverInfo;
      expect(typeof signal).toBe('function');
      expect((signal as unknown as { set?: unknown }).set).toBeUndefined();
    });
  });

  describe('getServerInfo()', () => {
    it('should fetch and cache server info', async () => {
      const mockInfo = createServerInfo();
      vaultSandboxApiSpy.getServerInfo.and.returnValue(of(mockInfo));

      const result = await service.getServerInfo();

      expect(result).toEqual(mockInfo);
      expect(service.serverInfo()).toEqual(mockInfo);
      expect(vaultSandboxApiSpy.getServerInfo).toHaveBeenCalledTimes(1);
    });

    it('should return cached value without making API call', async () => {
      const mockInfo = createServerInfo();
      vaultSandboxApiSpy.getServerInfo.and.returnValue(of(mockInfo));

      // First call - fetches from API
      await service.getServerInfo();
      expect(vaultSandboxApiSpy.getServerInfo).toHaveBeenCalledTimes(1);

      // Second call - returns cached value
      const result = await service.getServerInfo();
      expect(result).toEqual(mockInfo);
      expect(vaultSandboxApiSpy.getServerInfo).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate concurrent fetches', async () => {
      const mockInfo = createServerInfo();
      const subject = new Subject<ServerInfo>();
      vaultSandboxApiSpy.getServerInfo.and.returnValue(subject.asObservable());

      // Start multiple concurrent fetches
      const promise1 = service.getServerInfo();
      const promise2 = service.getServerInfo();
      const promise3 = service.getServerInfo();

      // Complete the fetch
      subject.next(mockInfo);
      subject.complete();

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      expect(result1).toEqual(mockInfo);
      expect(result2).toEqual(mockInfo);
      expect(result3).toEqual(mockInfo);
      expect(vaultSandboxApiSpy.getServerInfo).toHaveBeenCalledTimes(1);
    });

    it('should clear ongoingFetch after completion', async () => {
      const mockInfo1 = createServerInfo();
      const mockInfo2 = { ...createServerInfo(), context: 'different-context' };
      vaultSandboxApiSpy.getServerInfo.and.returnValues(of(mockInfo1), of(mockInfo2));

      // First fetch
      await service.getServerInfo();

      // Force refresh after first fetch completes - should start new fetch
      const result = await service.getServerInfo(true);

      expect(result).toEqual(mockInfo2);
      expect(vaultSandboxApiSpy.getServerInfo).toHaveBeenCalledTimes(2);
    });
  });

  describe('getServerInfo(forceRefresh)', () => {
    it('should bypass cache when forceRefresh is true', async () => {
      const mockInfo1 = createServerInfo();
      const mockInfo2 = { ...createServerInfo(), context: 'updated-context' };
      vaultSandboxApiSpy.getServerInfo.and.returnValues(of(mockInfo1), of(mockInfo2));

      // First call - fetches and caches
      const result1 = await service.getServerInfo();
      expect(result1).toEqual(mockInfo1);

      // Second call with forceRefresh - should fetch again
      const result2 = await service.getServerInfo(true);
      expect(result2).toEqual(mockInfo2);
      expect(service.serverInfo()).toEqual(mockInfo2);
      expect(vaultSandboxApiSpy.getServerInfo).toHaveBeenCalledTimes(2);
    });

    it('should start new fetch even when ongoing fetch exists if forceRefresh is true', async () => {
      const mockInfo1 = createServerInfo();
      const mockInfo2 = { ...createServerInfo(), context: 'force-refreshed' };

      const subject1 = new Subject<ServerInfo>();
      const subject2 = new Subject<ServerInfo>();
      let callCount = 0;

      vaultSandboxApiSpy.getServerInfo.and.callFake(() => {
        callCount++;
        return callCount === 1 ? subject1.asObservable() : subject2.asObservable();
      });

      // Start first fetch (not completed yet)
      const promise1 = service.getServerInfo();

      // Start force refresh while first is still pending
      const promise2 = service.getServerInfo(true);

      // Complete both fetches
      subject1.next(mockInfo1);
      subject1.complete();
      subject2.next(mockInfo2);
      subject2.complete();

      await Promise.all([promise1, promise2]);

      expect(vaultSandboxApiSpy.getServerInfo).toHaveBeenCalledTimes(2);
      // The signal should have the force-refreshed value
      expect(service.serverInfo()).toEqual(mockInfo2);
    });
  });

  describe('error handling', () => {
    it('should clear API key on 401 Unauthorized error', async () => {
      const error401 = new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' });
      vaultSandboxApiSpy.getServerInfo.and.returnValue(throwError(() => error401));
      spyOn(vaultSandboxStub, 'clearApiKey').and.callThrough();
      spyOn(console, 'error');
      spyOn(console, 'warn');

      const result = await service.getServerInfo();

      expect(result).toBeNull();
      expect(vaultSandboxStub.clearApiKey).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith('[ServerInfoService] Unauthorized - clearing API key');
    });

    it('should return cached value on non-401 errors', async () => {
      const mockInfo = createServerInfo();
      const error500 = new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' });

      // First successful fetch
      vaultSandboxApiSpy.getServerInfo.and.returnValues(
        of(mockInfo),
        throwError(() => error500),
      );

      await service.getServerInfo();
      expect(service.serverInfo()).toEqual(mockInfo);

      // Force refresh that fails
      spyOn(console, 'error');
      const result = await service.getServerInfo(true);

      expect(result).toEqual(mockInfo);
      expect(service.serverInfo()).toEqual(mockInfo);
    });

    it('should return null when error occurs with no cached value', async () => {
      const error500 = new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' });
      vaultSandboxApiSpy.getServerInfo.and.returnValue(throwError(() => error500));
      spyOn(console, 'error');

      const result = await service.getServerInfo();

      expect(result).toBeNull();
      expect(service.serverInfo()).toBeNull();
    });

    it('should not clear API key on non-401 errors', async () => {
      const error500 = new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' });
      vaultSandboxApiSpy.getServerInfo.and.returnValue(throwError(() => error500));
      spyOn(vaultSandboxStub, 'clearApiKey').and.callThrough();
      spyOn(console, 'error');

      await service.getServerInfo();

      expect(vaultSandboxStub.clearApiKey).not.toHaveBeenCalled();
    });

    it('should handle non-HttpErrorResponse errors', async () => {
      const genericError = new Error('Network failure');
      vaultSandboxApiSpy.getServerInfo.and.returnValue(throwError(() => genericError));
      spyOn(vaultSandboxStub, 'clearApiKey').and.callThrough();
      spyOn(console, 'error');

      const result = await service.getServerInfo();

      expect(result).toBeNull();
      expect(vaultSandboxStub.clearApiKey).not.toHaveBeenCalled();
    });
  });
});
