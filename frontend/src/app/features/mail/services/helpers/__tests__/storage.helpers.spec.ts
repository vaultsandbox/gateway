import {
  base64urlEncode,
  base64urlDecode,
  InboxStorageKeys,
  InboxStorageValidator,
  InboxStorageMapper,
  InboxStorageSafe,
  EXPORT_VERSION,
  MLKEM_SECRET_KEY_SIZE,
  MLDSA_PUBLIC_KEY_SIZE,
  StoredInboxRecord,
  StoredInboxesPayload,
} from '../storage.helpers';
import { InboxModel, ExportedInboxData } from '../../../interfaces';

describe('storage.helpers', () => {
  describe('Constants', () => {
    it('should have correct MLKEM_SECRET_KEY_SIZE', () => {
      expect(MLKEM_SECRET_KEY_SIZE).toBe(2400);
    });

    it('should have correct MLDSA_PUBLIC_KEY_SIZE', () => {
      expect(MLDSA_PUBLIC_KEY_SIZE).toBe(1952);
    });

    it('should have correct EXPORT_VERSION', () => {
      expect(EXPORT_VERSION).toBe(1);
    });
  });

  describe('base64urlEncode', () => {
    it('encodes empty array', () => {
      const result = base64urlEncode(new Uint8Array([]));
      expect(result).toBe('');
    });

    it('encodes simple data', () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const result = base64urlEncode(data);
      expect(result).toBe('SGVsbG8');
    });

    it('replaces + with -', () => {
      // Data that produces + in standard base64: 0xfb
      const data = new Uint8Array([251, 239]);
      const result = base64urlEncode(data);
      expect(result).not.toContain('+');
      expect(result).toContain('-');
    });

    it('replaces / with _', () => {
      // Data that produces / in standard base64: 0xff
      const data = new Uint8Array([255, 255]);
      const result = base64urlEncode(data);
      expect(result).not.toContain('/');
      expect(result).toContain('_');
    });

    it('removes padding', () => {
      // Data that would produce = padding in standard base64
      const data = new Uint8Array([72]); // Single byte
      const result = base64urlEncode(data);
      expect(result).not.toContain('=');
      expect(result).toBe('SA');
    });
  });

  describe('base64urlDecode', () => {
    it('decodes empty string', () => {
      const result = base64urlDecode('');
      expect(result).toEqual(new Uint8Array([]));
    });

    it('decodes simple data', () => {
      const result = base64urlDecode('SGVsbG8');
      expect(result).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    });

    it('decodes data with - (converts to +)', () => {
      const encoded = base64urlEncode(new Uint8Array([251, 239]));
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(new Uint8Array([251, 239]));
    });

    it('decodes data with _ (converts to /)', () => {
      const encoded = base64urlEncode(new Uint8Array([255, 255]));
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(new Uint8Array([255, 255]));
    });

    it('throws error for string containing +', () => {
      expect(() => base64urlDecode('SGVs+G8')).toThrowError('Invalid base64url: contains +, /, or = characters');
    });

    it('throws error for string containing /', () => {
      expect(() => base64urlDecode('SGVs/G8')).toThrowError('Invalid base64url: contains +, /, or = characters');
    });

    it('throws error for string containing =', () => {
      expect(() => base64urlDecode('SGVsbG8=')).toThrowError('Invalid base64url: contains +, /, or = characters');
    });

    it('handles strings that need 1 character padding', () => {
      // "AB" needs 2 characters padding to make length divisible by 4
      const result = base64urlDecode('QUI');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles strings that need 2 characters padding', () => {
      // Single base64url char needs 3 padding chars
      const result = base64urlDecode('QQ');
      expect(result.length).toBeGreaterThan(0);
    });

    it('roundtrips correctly', () => {
      const original = new Uint8Array([0, 127, 255, 128, 64, 32, 16, 8, 4, 2, 1]);
      const encoded = base64urlEncode(original);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe('InboxStorageKeys', () => {
    it('has INBOXES_KEY constant', () => {
      expect(InboxStorageKeys.INBOXES_KEY).toBe('vaultsandbox_inboxes');
    });

    it('has SETTINGS_KEY constant', () => {
      expect(InboxStorageKeys.SETTINGS_KEY).toBe('vaultsandbox_settings');
    });
  });

  describe('InboxStorageValidator', () => {
    describe('isValidBase64url', () => {
      it('returns true for valid base64url string', () => {
        const validString = base64urlEncode(new Uint8Array([1, 2, 3]));
        expect(InboxStorageValidator.isValidBase64url(validString)).toBeTrue();
      });

      it('returns true for empty string', () => {
        expect(InboxStorageValidator.isValidBase64url('')).toBeTrue();
      });

      it('returns false for string containing +', () => {
        expect(InboxStorageValidator.isValidBase64url('abc+def')).toBeFalse();
      });

      it('returns false for string containing /', () => {
        expect(InboxStorageValidator.isValidBase64url('abc/def')).toBeFalse();
      });

      it('returns false for string containing =', () => {
        expect(InboxStorageValidator.isValidBase64url('abc=')).toBeFalse();
      });

      it('returns false for string with invalid characters', () => {
        expect(InboxStorageValidator.isValidBase64url('abc!@#')).toBeFalse();
      });

      it('returns false for string with spaces', () => {
        expect(InboxStorageValidator.isValidBase64url('abc def')).toBeFalse();
      });
    });

    describe('isValidBase64urlWithSize', () => {
      it('returns true when decoded size matches expected', () => {
        const data = new Uint8Array(100);
        const encoded = base64urlEncode(data);
        expect(InboxStorageValidator.isValidBase64urlWithSize(encoded, 100)).toBeTrue();
      });

      it('returns false when decoded size does not match expected', () => {
        const data = new Uint8Array(50);
        const encoded = base64urlEncode(data);
        expect(InboxStorageValidator.isValidBase64urlWithSize(encoded, 100)).toBeFalse();
      });

      it('returns false for invalid base64url', () => {
        expect(InboxStorageValidator.isValidBase64urlWithSize('invalid+string', 100)).toBeFalse();
      });
    });

    describe('isStoredInboxRecord', () => {
      const validRecord: StoredInboxRecord = {
        version: 1,
        emailAddress: 'test@example.com',
        expiresAt: '2024-12-31T23:59:59.000Z',
        inboxHash: 'hash123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'serverKey',
        secretKey: 'secretKey',
      };

      it('returns true for valid encrypted record', () => {
        expect(InboxStorageValidator.isStoredInboxRecord(validRecord)).toBeTrue();
      });

      it('returns true for valid plain record', () => {
        const plainRecord: StoredInboxRecord = {
          version: 1,
          emailAddress: 'test@example.com',
          expiresAt: '2024-12-31T23:59:59.000Z',
          inboxHash: 'hash123',
          encrypted: false,
          emailAuth: false,
        };
        expect(InboxStorageValidator.isStoredInboxRecord(plainRecord)).toBeTrue();
      });

      it('returns false for null', () => {
        expect(InboxStorageValidator.isStoredInboxRecord(null)).toBeFalse();
      });

      it('returns false for undefined', () => {
        expect(InboxStorageValidator.isStoredInboxRecord(undefined)).toBeFalse();
      });

      it('returns false for non-object', () => {
        expect(InboxStorageValidator.isStoredInboxRecord('string')).toBeFalse();
      });

      it('returns false for wrong version', () => {
        expect(InboxStorageValidator.isStoredInboxRecord({ ...validRecord, version: 2 })).toBeFalse();
      });

      it('returns false for missing emailAddress', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { emailAddress, ...rest } = validRecord;
        expect(InboxStorageValidator.isStoredInboxRecord(rest)).toBeFalse();
      });

      it('returns false for non-string emailAddress', () => {
        expect(InboxStorageValidator.isStoredInboxRecord({ ...validRecord, emailAddress: 123 })).toBeFalse();
      });

      it('returns false for missing expiresAt', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { expiresAt, ...rest } = validRecord;
        expect(InboxStorageValidator.isStoredInboxRecord(rest)).toBeFalse();
      });

      it('returns false for missing inboxHash', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { inboxHash, ...rest } = validRecord;
        expect(InboxStorageValidator.isStoredInboxRecord(rest)).toBeFalse();
      });

      it('returns false for missing encrypted field', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { encrypted, ...rest } = validRecord;
        expect(InboxStorageValidator.isStoredInboxRecord(rest)).toBeFalse();
      });

      it('returns false for encrypted inbox missing serverSigPk', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { serverSigPk, ...rest } = validRecord;
        expect(InboxStorageValidator.isStoredInboxRecord(rest)).toBeFalse();
      });

      it('returns false for encrypted inbox missing secretKey', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { secretKey, ...rest } = validRecord;
        expect(InboxStorageValidator.isStoredInboxRecord(rest)).toBeFalse();
      });
    });

    describe('isStoredInboxesPayload', () => {
      const validRecord: StoredInboxRecord = {
        version: 1,
        emailAddress: 'test@example.com',
        expiresAt: '2024-12-31T23:59:59.000Z',
        inboxHash: 'hash123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'serverKey',
        secretKey: 'secretKey',
      };

      it('returns true for valid payload with inboxes', () => {
        const payload: StoredInboxesPayload = { inboxes: [validRecord] };
        expect(InboxStorageValidator.isStoredInboxesPayload(payload)).toBeTrue();
      });

      it('returns true for empty inboxes array', () => {
        const payload: StoredInboxesPayload = { inboxes: [] };
        expect(InboxStorageValidator.isStoredInboxesPayload(payload)).toBeTrue();
      });

      it('returns false for null', () => {
        expect(InboxStorageValidator.isStoredInboxesPayload(null)).toBeFalse();
      });

      it('returns false for undefined', () => {
        expect(InboxStorageValidator.isStoredInboxesPayload(undefined)).toBeFalse();
      });

      it('returns false for non-object', () => {
        expect(InboxStorageValidator.isStoredInboxesPayload('string')).toBeFalse();
      });

      it('returns false for missing inboxes array', () => {
        expect(InboxStorageValidator.isStoredInboxesPayload({})).toBeFalse();
      });

      it('returns false for non-array inboxes', () => {
        expect(InboxStorageValidator.isStoredInboxesPayload({ inboxes: 'not-array' })).toBeFalse();
      });

      it('returns false if any inbox is invalid', () => {
        const payload = { inboxes: [validRecord, { invalid: true }] };
        expect(InboxStorageValidator.isStoredInboxesPayload(payload)).toBeFalse();
      });
    });

    describe('isValidImportData', () => {
      const createValidImportData = (): ExportedInboxData => ({
        version: 1,
        emailAddress: 'test@example.com',
        expiresAt: '2024-12-31T23:59:59.000Z',
        inboxHash: 'hash123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: base64urlEncode(new Uint8Array(MLDSA_PUBLIC_KEY_SIZE)),
        secretKey: base64urlEncode(new Uint8Array(MLKEM_SECRET_KEY_SIZE)),
        exportedAt: '2024-01-01T00:00:00.000Z',
      });

      it('returns true for valid import data', () => {
        expect(InboxStorageValidator.isValidImportData(createValidImportData())).toBeTrue();
      });

      it('returns false for null', () => {
        expect(InboxStorageValidator.isValidImportData(null)).toBeFalse();
      });

      it('returns false for undefined', () => {
        expect(InboxStorageValidator.isValidImportData(undefined)).toBeFalse();
      });

      it('returns false for non-object', () => {
        expect(InboxStorageValidator.isValidImportData('string')).toBeFalse();
      });

      it('returns false for wrong version', () => {
        expect(InboxStorageValidator.isValidImportData({ ...createValidImportData(), version: 2 })).toBeFalse();
      });

      it('returns false for missing version', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { version, ...rest } = createValidImportData();
        expect(InboxStorageValidator.isValidImportData(rest)).toBeFalse();
      });

      it('returns false for non-string emailAddress', () => {
        expect(InboxStorageValidator.isValidImportData({ ...createValidImportData(), emailAddress: 123 })).toBeFalse();
      });

      it('returns false for non-string expiresAt', () => {
        expect(InboxStorageValidator.isValidImportData({ ...createValidImportData(), expiresAt: 123 })).toBeFalse();
      });

      it('returns false for non-string inboxHash', () => {
        expect(InboxStorageValidator.isValidImportData({ ...createValidImportData(), inboxHash: 123 })).toBeFalse();
      });

      it('returns false for non-string serverSigPk', () => {
        expect(InboxStorageValidator.isValidImportData({ ...createValidImportData(), serverSigPk: 123 })).toBeFalse();
      });

      it('returns false for non-string secretKey', () => {
        expect(InboxStorageValidator.isValidImportData({ ...createValidImportData(), secretKey: 123 })).toBeFalse();
      });

      it('returns false for non-string exportedAt', () => {
        expect(InboxStorageValidator.isValidImportData({ ...createValidImportData(), exportedAt: 123 })).toBeFalse();
      });

      it('returns false for emailAddress without @', () => {
        expect(
          InboxStorageValidator.isValidImportData({ ...createValidImportData(), emailAddress: 'invalid' }),
        ).toBeFalse();
      });

      it('returns false for emailAddress with multiple @', () => {
        expect(
          InboxStorageValidator.isValidImportData({ ...createValidImportData(), emailAddress: 'test@@example.com' }),
        ).toBeFalse();
      });

      it('returns false for empty inboxHash', () => {
        expect(InboxStorageValidator.isValidImportData({ ...createValidImportData(), inboxHash: '' })).toBeFalse();
      });

      it('returns false for invalid secretKey base64url', () => {
        expect(
          InboxStorageValidator.isValidImportData({ ...createValidImportData(), secretKey: 'invalid+base64' }),
        ).toBeFalse();
      });

      it('returns false for wrong secretKey size', () => {
        expect(
          InboxStorageValidator.isValidImportData({
            ...createValidImportData(),
            secretKey: base64urlEncode(new Uint8Array(100)),
          }),
        ).toBeFalse();
      });

      it('returns false for invalid serverSigPk base64url', () => {
        expect(
          InboxStorageValidator.isValidImportData({ ...createValidImportData(), serverSigPk: 'invalid+base64' }),
        ).toBeFalse();
      });

      it('returns false for wrong serverSigPk size', () => {
        expect(
          InboxStorageValidator.isValidImportData({
            ...createValidImportData(),
            serverSigPk: base64urlEncode(new Uint8Array(100)),
          }),
        ).toBeFalse();
      });
    });
  });

  describe('InboxStorageMapper', () => {
    const createInboxModel = (): InboxModel => ({
      emailAddress: 'test@example.com',
      expiresAt: '2024-12-31T23:59:59.000Z',
      inboxHash: 'hash123',
      encrypted: true,
      emailAuth: false,
      serverSigPk: 'serverKey',
      secretKey: new Uint8Array([1, 2, 3, 4, 5]),
      emails: [],
    });

    describe('toStoredRecords', () => {
      it('converts inbox models to stored records', () => {
        const inboxes = [createInboxModel()];
        const records = InboxStorageMapper.toStoredRecords(inboxes);

        expect(records.length).toBe(1);
        expect(records[0].version).toBe(EXPORT_VERSION);
        expect(records[0].emailAddress).toBe('test@example.com');
        expect(records[0].expiresAt).toBe('2024-12-31T23:59:59.000Z');
        expect(records[0].inboxHash).toBe('hash123');
        expect(records[0].serverSigPk).toBe('serverKey');
        expect(typeof records[0].secretKey).toBe('string');
      });

      it('handles multiple inboxes', () => {
        const inbox1 = createInboxModel();
        const inbox2 = { ...createInboxModel(), emailAddress: 'test2@example.com' };
        const records = InboxStorageMapper.toStoredRecords([inbox1, inbox2]);

        expect(records.length).toBe(2);
        expect(records[0].emailAddress).toBe('test@example.com');
        expect(records[1].emailAddress).toBe('test2@example.com');
      });

      it('handles empty array', () => {
        expect(InboxStorageMapper.toStoredRecords([])).toEqual([]);
      });

      it('encodes secretKey as base64url', () => {
        const inbox = createInboxModel();
        const records = InboxStorageMapper.toStoredRecords([inbox]);

        const decoded = base64urlDecode(records[0].secretKey!);
        expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
      });
    });

    describe('toInboxModels', () => {
      it('converts stored payload to inbox models', () => {
        const payload: StoredInboxesPayload = {
          inboxes: [
            {
              version: 1,
              emailAddress: 'test@example.com',
              emailAuth: false,
              expiresAt: '2024-12-31T23:59:59.000Z',
              inboxHash: 'hash123',
              encrypted: true,
              serverSigPk: 'serverKey',
              secretKey: base64urlEncode(new Uint8Array([1, 2, 3])),
            },
          ],
        };

        const models = InboxStorageMapper.toInboxModels(payload);

        expect(models.length).toBe(1);
        expect(models[0].emailAddress).toBe('test@example.com');
        expect(models[0].expiresAt).toBe('2024-12-31T23:59:59.000Z');
        expect(models[0].inboxHash).toBe('hash123');
        expect(models[0].encrypted).toBe(true);
        expect(models[0].serverSigPk).toBe('serverKey');
        expect(models[0].secretKey).toEqual(new Uint8Array([1, 2, 3]));
        expect(models[0].emails).toEqual([]);
      });

      it('handles empty inboxes array', () => {
        const payload: StoredInboxesPayload = { inboxes: [] };
        expect(InboxStorageMapper.toInboxModels(payload)).toEqual([]);
      });

      it('handles multiple inboxes', () => {
        const payload: StoredInboxesPayload = {
          inboxes: [
            {
              version: 1,
              emailAddress: 'test1@example.com',
              expiresAt: '2024-12-31T23:59:59.000Z',
              inboxHash: 'hash1',
              encrypted: true,
              emailAuth: false,
              serverSigPk: 'serverKey1',
              secretKey: base64urlEncode(new Uint8Array([1])),
            },
            {
              version: 1,
              emailAddress: 'test2@example.com',
              expiresAt: '2024-12-31T23:59:59.000Z',
              inboxHash: 'hash2',
              encrypted: true,
              emailAuth: false,
              serverSigPk: 'serverKey2',
              secretKey: base64urlEncode(new Uint8Array([2])),
            },
          ],
        };

        const models = InboxStorageMapper.toInboxModels(payload);
        expect(models.length).toBe(2);
        expect(models[0].emailAddress).toBe('test1@example.com');
        expect(models[1].emailAddress).toBe('test2@example.com');
      });
    });

    describe('exportInbox', () => {
      it('creates export data from inbox model', () => {
        const inbox = createInboxModel();

        const exported = InboxStorageMapper.exportInbox(inbox);

        expect(exported.version).toBe(1);
        expect(exported.emailAddress).toBe('test@example.com');
        expect(exported.expiresAt).toBe('2024-12-31T23:59:59.000Z');
        expect(exported.inboxHash).toBe('hash123');
        expect(exported.serverSigPk).toBe('serverKey');
        expect(typeof exported.secretKey).toBe('string');
        expect(typeof exported.exportedAt).toBe('string');
      });

      it('sets exportedAt to current time', () => {
        const beforeExport = new Date().toISOString();
        const inbox = createInboxModel();

        const exported = InboxStorageMapper.exportInbox(inbox);
        const afterExport = new Date().toISOString();

        expect(exported.exportedAt >= beforeExport).toBeTrue();
        expect(exported.exportedAt <= afterExport).toBeTrue();
      });

      it('encodes secretKey as base64url', () => {
        const inbox = createInboxModel();

        const exported = InboxStorageMapper.exportInbox(inbox);
        const decoded = base64urlDecode(exported.secretKey!);

        expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
      });
    });

    describe('sanitizeEmailForFilename', () => {
      it('replaces @ with _at_', () => {
        expect(InboxStorageMapper.sanitizeEmailForFilename('user@example.com')).toBe('user_at_example.com');
      });

      it('replaces invalid characters with _', () => {
        expect(InboxStorageMapper.sanitizeEmailForFilename('user+tag@example.com')).toBe('user_tag_at_example.com');
      });

      it('preserves allowed characters', () => {
        expect(InboxStorageMapper.sanitizeEmailForFilename('user.name-test@example.com')).toBe(
          'user.name-test_at_example.com',
        );
      });

      it('handles multiple @ symbols', () => {
        expect(InboxStorageMapper.sanitizeEmailForFilename('user@@example.com')).toBe('user_at__at_example.com');
      });

      it('handles special characters', () => {
        // !#$% are 4 invalid characters, plus @ = 5 replacements
        expect(InboxStorageMapper.sanitizeEmailForFilename('user!#$%@example.com')).toBe('user_____at_example.com');
      });
    });
  });

  describe('InboxStorageSafe', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    describe('trySetItem', () => {
      it('sets item in localStorage', () => {
        InboxStorageSafe.trySetItem('testKey', 'testValue');
        expect(localStorage.getItem('testKey')).toBe('testValue');
      });

      it('overwrites existing value', () => {
        localStorage.setItem('testKey', 'oldValue');
        InboxStorageSafe.trySetItem('testKey', 'newValue');
        expect(localStorage.getItem('testKey')).toBe('newValue');
      });
    });

    describe('tryGetItem', () => {
      it('gets item from localStorage', () => {
        localStorage.setItem('testKey', 'testValue');
        expect(InboxStorageSafe.tryGetItem('testKey')).toBe('testValue');
      });

      it('returns null for non-existent key', () => {
        expect(InboxStorageSafe.tryGetItem('nonExistent')).toBeNull();
      });
    });

    describe('tryRemoveItem', () => {
      it('removes item from localStorage', () => {
        localStorage.setItem('testKey', 'testValue');
        InboxStorageSafe.tryRemoveItem('testKey');
        expect(localStorage.getItem('testKey')).toBeNull();
      });

      it('does not throw for non-existent key', () => {
        expect(() => InboxStorageSafe.tryRemoveItem('nonExistent')).not.toThrow();
      });
    });
  });
});
