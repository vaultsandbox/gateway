import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { VaultSandboxApi } from '../vault-sandbox-api';
import { environment } from '../../../../../environments/environment';

describe('VaultSandboxApi', () => {
  let service: VaultSandboxApi;
  let httpMock: HttpTestingController;
  const baseUrl = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(VaultSandboxApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('checkKey', () => {
    it('should make GET request to /check-key', () => {
      const mockResponse = { ok: true };

      service.checkKey().subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/check-key`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('getServerInfo', () => {
    it('should make GET request to /server-info', () => {
      const mockResponse = {
        serverSigPk: 'test-pk',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'test-context',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowedDomains: ['example.com'],
      };

      service.getServerInfo().subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/server-info`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('createInbox', () => {
    const mockResponse = {
      emailAddress: 'test@example.com',
      expiresAt: '2024-01-01T00:00:00Z',
      inboxHash: 'test-hash',
      serverSigPk: 'test-pk',
    };

    it('should make POST request with only clientKemPk', () => {
      service.createInbox('test-kem-pk').subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ clientKemPk: 'test-kem-pk' });
      req.flush(mockResponse);
    });

    it('should include ttl when provided', () => {
      service.createInbox('test-kem-pk', 7200).subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ clientKemPk: 'test-kem-pk', ttl: 7200 });
      req.flush(mockResponse);
    });

    it('should include emailAddress when provided', () => {
      service.createInbox('test-kem-pk', undefined, 'custom@example.com').subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ clientKemPk: 'test-kem-pk', emailAddress: 'custom@example.com' });
      req.flush(mockResponse);
    });

    it('should include both ttl and emailAddress when provided', () => {
      service.createInbox('test-kem-pk', 3600, 'custom@example.com').subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        clientKemPk: 'test-kem-pk',
        ttl: 3600,
        emailAddress: 'custom@example.com',
      });
      req.flush(mockResponse);
    });

    it('should not include ttl when explicitly set to 0', () => {
      service.createInbox('test-kem-pk', 0).subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes`);
      expect(req.request.body).toEqual({ clientKemPk: 'test-kem-pk', ttl: 0 });
      req.flush(mockResponse);
    });

    it('should not include emailAddress when empty string', () => {
      service.createInbox('test-kem-pk', undefined, '').subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes`);
      expect(req.request.body).toEqual({ clientKemPk: 'test-kem-pk' });
      req.flush(mockResponse);
    });
  });

  describe('listEmails', () => {
    it('should make GET request to /inboxes/:emailAddress/emails', () => {
      const mockResponse = [
        {
          id: 'email-1',
          encryptedMetadata: {
            v: 1,
            algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
            ct_kem: '',
            nonce: '',
            aad: '',
            ciphertext: '',
            sig: '',
            server_sig_pk: 'pk',
          },
          isRead: false,
        },
      ];

      service.listEmails('test@example.com').subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes/test@example.com/emails`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('getInboxSyncStatus', () => {
    it('should make GET request to /inboxes/:emailAddress/sync', () => {
      const mockResponse = { emailsHash: 'abc123', emailCount: 5 };

      service.getInboxSyncStatus('test@example.com').subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes/test@example.com/sync`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('getEmail', () => {
    it('should make GET request to /inboxes/:emailAddress/emails/:emailId', () => {
      const mockResponse = {
        encryptedParsed: {
          v: 1,
          algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
          ct_kem: '',
          nonce: '',
          aad: '',
          ciphertext: '',
          sig: '',
          server_sig_pk: 'pk',
        },
        isRead: true,
      };

      service.getEmail('test@example.com', 'email-123').subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes/test@example.com/emails/email-123`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('getRawEmail', () => {
    it('should make GET request to /inboxes/:emailAddress/emails/:emailId/raw', () => {
      const mockResponse = {
        encryptedRaw: {
          v: 1,
          algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
          ct_kem: '',
          nonce: '',
          aad: '',
          ciphertext: '',
          sig: '',
          server_sig_pk: 'pk',
        },
      };

      service.getRawEmail('test@example.com', 'email-123').subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/inboxes/test@example.com/emails/email-123/raw`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('deleteInbox', () => {
    it('should make DELETE request to /inboxes/:emailAddress', () => {
      service.deleteInbox('test@example.com').subscribe();

      const req = httpMock.expectOne(`${baseUrl}/inboxes/test@example.com`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('markEmailAsRead', () => {
    it('should make PATCH request to /inboxes/:emailAddress/emails/:emailId/read', () => {
      service.markEmailAsRead('test@example.com', 'email-123').subscribe();

      const req = httpMock.expectOne(`${baseUrl}/inboxes/test@example.com/emails/email-123/read`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({});
      req.flush(null);
    });
  });

  describe('deleteEmail', () => {
    it('should make DELETE request to /inboxes/:emailAddress/emails/:emailId', () => {
      service.deleteEmail('test@example.com', 'email-123').subscribe();

      const req = httpMock.expectOne(`${baseUrl}/inboxes/test@example.com/emails/email-123`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('clearAllInboxes', () => {
    it('should make DELETE request to /inboxes', () => {
      service.clearAllInboxes().subscribe();

      const req = httpMock.expectOne(`${baseUrl}/inboxes`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
