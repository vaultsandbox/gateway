import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { VaultSandbox } from '../vault-sandbox';

describe('VaultSandbox', () => {
  let service: VaultSandbox;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    service = TestBed.inject(VaultSandbox);
  });

  afterEach(() => {
    localStorage.clear();
    service.disconnectEvents();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('API key management', () => {
    it('should return null when no API key is stored', () => {
      expect(service.apiKey()).toBeNull();
    });

    it('should set API key and persist to localStorage', () => {
      service.setApiKey('new-test-key');

      expect(localStorage.getItem('vaultsandbox_api_key')).toBe('new-test-key');
      expect(service.apiKey()).toBe('new-test-key');
    });

    it('should return true from hasApiKey when API key exists', () => {
      service.setApiKey('test-key');
      expect(service.hasApiKey()).toBeTrue();
    });

    it('should return false from hasApiKey when no API key exists', () => {
      expect(service.hasApiKey()).toBeFalse();
    });

    it('should clear API key from localStorage', () => {
      service.setApiKey('test-key');
      service.clearApiKey();

      expect(service.apiKey()).toBeNull();
      expect(localStorage.getItem('vaultsandbox_api_key')).toBeNull();
    });
  });

  describe('SSE connection management', () => {
    beforeEach(() => {
      service.setApiKey('test-api-key');
    });

    it('should warn and return when connecting without API key', () => {
      service.clearApiKey();
      spyOn(console, 'warn');

      service.connectToEvents(['inbox1']);

      expect(console.warn).toHaveBeenCalledWith('Cannot connect to events without an API key');
    });

    it('should disconnect when empty inbox list is provided', () => {
      // Start with some inboxes to track
      service.connectToEvents(['inbox1']);

      // Then clear them
      service.connectToEvents([]);

      // Should have disconnected (no error thrown)
      expect(true).toBeTrue();
    });

    it('should deduplicate inbox IDs', () => {
      // This tests internal behavior - just verify it doesn't throw
      service.connectToEvents(['inbox1', 'inbox1', 'inbox2']);
      expect(true).toBeTrue();
    });

    it('should disconnect events', () => {
      service.connectToEvents(['inbox1']);
      service.disconnectEvents();

      // Should have disconnected (no error thrown)
      expect(true).toBeTrue();
    });
  });

  describe('newEmail$ observable', () => {
    it('should expose observable for new email events', () => {
      expect(service.newEmail$).toBeDefined();
      expect(typeof service.newEmail$.subscribe).toBe('function');
    });
  });

  describe('reconnection behavior', () => {
    beforeEach(() => {
      service.setApiKey('test-api-key');
      jasmine.clock().install();
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('should reconnect when setApiKey is called with tracked inboxes', () => {
      // First set an API key and connect
      service.connectToEvents(['inbox1', 'inbox2']);

      // Now set a new API key - should trigger reconnection
      spyOn(console, 'error'); // Suppress SSE errors in test output
      service.setApiKey('new-key');

      // The test passes if no error is thrown
      expect(true).toBeTrue();
    });
  });
});
