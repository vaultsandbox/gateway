import { EmailValidationService } from './../email-validation.service';
import type { DkimResult, SpfResult } from './../interfaces/email-session.interface';
import { promises as dns } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { dkimVerify } from 'mailauth/lib/dkim/verify';
import { dmarc } from 'mailauth/lib/dmarc';
import { spf } from 'mailauth/lib/spf';

jest.mock('mailauth/lib/dkim/verify', () => ({
  dkimVerify: jest.fn(),
}));

jest.mock('mailauth/lib/dmarc', () => ({
  dmarc: jest.fn(),
}));

jest.mock('mailauth/lib/spf', () => ({
  spf: jest.fn(),
}));

describe('EmailValidationService', () => {
  let service: EmailValidationService;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const mockedDkimVerify = dkimVerify;
  const mockedDmarc = dmarc;
  const mockedSpf = spf;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmailValidationService();
    logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('verifySpf', () => {
    it('returns default result when the domain or remote IP is missing', async () => {
      const result = await service.verifySpf(undefined, '192.0.2.5', 'sender@example.com', 'session-default');

      expect(result).toEqual({
        status: 'none',
        domain: undefined,
        ip: '192.0.2.5',
        info: 'SPF check skipped',
      });
      expect(mockedSpf).not.toHaveBeenCalled();
    });

    it('returns SPF details when the library resolves successfully', async () => {
      mockedSpf.mockResolvedValue({
        status: { result: 'pass', comment: 'ok' },
        info: 'spf data',
      } as never);

      const result = await service.verifySpf('example.com', '192.0.2.1', 'sender@example.com', 'session-success');

      expect(result).toEqual({
        status: 'pass',
        domain: 'example.com',
        ip: '192.0.2.1',
        info: 'spf data',
      });
      expect(logSpy).toHaveBeenCalledWith(
        "SPF check (session=session-success): PASS for domain 'example.com' from IP '192.0.2.1' - spf data",
      );
    });

    it('returns temperror when the SPF library throws', async () => {
      mockedSpf.mockRejectedValue(new Error('spf boom'));

      const result = await service.verifySpf('example.com', '192.0.2.1', 'sender@example.com', 'session-spf');

      expect(result).toEqual({
        status: 'temperror',
        domain: 'example.com',
        ip: '192.0.2.1',
        info: 'spf boom',
      });
      expect(warnSpy).toHaveBeenCalledWith('SPF check failed (session=session-spf): spf boom');
    });
  });

  describe('verifyDkim', () => {
    it('returns DKIM signature details when results are present', async () => {
      mockedDkimVerify.mockResolvedValue({
        results: [
          { status: { result: 'pass' }, signingDomain: 'example.com', selector: 'sel1', info: 'sig ok' },
          { status: { result: 'fail' }, domain: 'fail.com', selector: 'sel2' },
          { status: 'neutral', domain: 'neutral.com', selector: 'sel3' },
        ],
      } as never);

      const result = await service.verifyDkim(Buffer.from('raw'), 'session-dkim');

      expect(result).toEqual([
        { status: 'pass', domain: 'example.com', selector: 'sel1', info: 'sig ok' },
        { status: 'fail', domain: 'fail.com', selector: 'sel2', info: 'fail' },
        { status: 'none', domain: 'neutral.com', selector: 'sel3', info: 'neutral' },
      ]);
      expect(logSpy).toHaveBeenCalledWith(
        "DKIM check (session=session-dkim): PASS for domain 'example.com' selector 'sel1' - sig ok",
      );
    });

    it('returns none when no DKIM signatures are present', async () => {
      mockedDkimVerify.mockResolvedValue({ results: [] } as never);

      const result = await service.verifyDkim(Buffer.from('raw'), 'session-123');

      expect(result).toEqual([
        {
          status: 'none',
          info: 'No DKIM signatures found in email',
        },
      ]);
      expect(logSpy).toHaveBeenCalledWith('DKIM check (session=session-123): No DKIM signatures found');
    });

    it('handles DKIM verification errors gracefully', async () => {
      mockedDkimVerify.mockRejectedValue(new Error('dkim boom'));

      const result = await service.verifyDkim(Buffer.from('raw'), 'session-err');

      expect(result).toEqual([
        {
          status: 'none',
          info: 'dkim boom',
        },
      ]);
      expect(warnSpy).toHaveBeenCalledWith('DKIM verification error (session=session-err): dkim boom');
    });
  });

  describe('verifyDmarc', () => {
    const headersWithFrom = { from: 'User <user@example.com>' };
    const spfResult: SpfResult = {
      status: 'pass',
      domain: 'example.com',
      info: 'ok',
    };
    const dkimResults: DkimResult[] = [
      {
        status: 'pass',
        domain: 'example.com',
        selector: 'selector',
      },
    ];

    it('returns none when no From header is present', async () => {
      const result = await service.verifyDmarc({}, undefined, undefined, 'session-none');

      expect(result).toEqual({
        status: 'none',
        info: 'No From header present in message',
      });
      expect(logSpy).toHaveBeenCalledWith('DMARC check (session=session-none): NONE - No From header present');
    });

    it('returns fail when DMARC evaluation is unavailable', async () => {
      mockedDmarc.mockResolvedValue(undefined as never);

      const result = await service.verifyDmarc(headersWithFrom, spfResult, dkimResults, 'session-eval');

      expect(result).toEqual({
        status: 'fail',
        info: 'Unable to evaluate DMARC policy',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        'DMARC validation failed (session=session-eval): Unable to evaluate DMARC policy',
      );
    });

    it('logs details for pass, fail, and none statuses', async () => {
      mockedDmarc.mockResolvedValue({
        status: { result: 'pass' },
        policy: 'reject',
        alignment: { spf: { result: 'pass' } },
        domain: 'Example.com',
      } as never);

      const passResult = await service.verifyDmarc(headersWithFrom, spfResult, dkimResults, 'session-pass');

      expect(passResult.status).toBe('pass');
      expect(logSpy).toHaveBeenCalledWith(
        "DMARC check (session=session-pass): PASS for domain='example.com' policy=reject aligned=true",
      );

      warnSpy.mockClear();
      mockedDmarc.mockResolvedValue({
        status: { result: 'fail' },
        policy: 'quarantine',
        domain: 'Fail.com',
        info: 'Alignment failure',
      } as never);

      const failResult = await service.verifyDmarc({ from: 'other@fail.com' }, undefined, undefined, 'session-fail');

      expect(failResult.status).toBe('fail');
      expect(warnSpy).toHaveBeenCalledWith(
        'DMARC validation failed (session=session-fail): domain=fail.com policy=quarantine aligned=false - Alignment failure',
      );

      logSpy.mockClear();
      mockedDmarc.mockResolvedValue({
        status: 'neutral',
        alignment: {},
        domain: 'None.com',
      } as never);

      const noneResult = await service.verifyDmarc(
        { from: 'user@none.com' },
        undefined,
        undefined,
        'session-none-status',
      );

      expect(noneResult.status).toBe('none');
      expect(logSpy).toHaveBeenCalledWith(
        "DMARC check (session=session-none-status): NONE for domain='none.com' - No DMARC policy",
      );
    });

    it('returns none when the DMARC library throws', async () => {
      mockedDmarc.mockRejectedValue(new Error('dmarc boom'));

      const result = await service.verifyDmarc(headersWithFrom, spfResult, dkimResults, 'session-error');

      expect(result).toEqual({
        status: 'none',
        info: 'dmarc boom',
      });
      expect(warnSpy).toHaveBeenCalledWith('DMARC verification error (session=session-error): dmarc boom');
    });
  });

  describe('verifyReverseDns', () => {
    it('returns pass when the PTR hostname resolves back to the IP', async () => {
      const reverseSpy = jest.spyOn(dns, 'reverse').mockResolvedValue(['mail.example']);
      const lookupSpy = jest
        .spyOn(dns, 'lookup')
        .mockResolvedValue([{ address: '203.0.113.10' } as LookupAddress, { address: '198.51.100.2' }]);

      const result = await service.verifyReverseDns('203.0.113.10', 'session-ptr-pass');

      expect(result).toEqual({
        status: 'pass',
        ip: '203.0.113.10',
        hostname: 'mail.example',
        info: 'PTR hostname resolves back to originating IP',
      });
      expect(logSpy).toHaveBeenCalledWith(
        "Reverse DNS check (session=session-ptr-pass): PASS ip='203.0.113.10' hostname='mail.example'",
      );

      reverseSpy.mockRestore();
      lookupSpy.mockRestore();
    });

    it('returns fail when PTR hostnames do not match the original IP', async () => {
      const reverseSpy = jest.spyOn(dns, 'reverse').mockResolvedValue(['Mismatch.example']);
      const lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '192.0.2.55' } as LookupAddress]);

      const result = await service.verifyReverseDns('203.0.113.10', 'session-ptr-mismatch');

      expect(result).toEqual({
        status: 'fail',
        ip: '203.0.113.10',
        hostname: 'mismatch.example',
        info: 'PTR hostname does not resolve back to originating IP',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "Reverse DNS check (session=session-ptr-mismatch): FAIL ip='203.0.113.10' - PTR hostname does not resolve to the same IP",
      );

      reverseSpy.mockRestore();
      lookupSpy.mockRestore();
    });

    it('returns none when no remote IP is available', async () => {
      const result = await service.verifyReverseDns(undefined, 'session-nip');

      expect(result).toEqual({
        status: 'none',
        info: 'No remote IP address available for reverse DNS lookup',
      });
    });

    it('fails when no PTR records can be found', async () => {
      const reverseSpy = jest.spyOn(dns, 'reverse').mockResolvedValue([]);

      const result = await service.verifyReverseDns('203.0.113.10', 'session-ptr');

      expect(result).toEqual({
        status: 'fail',
        ip: '203.0.113.10',
        info: 'No PTR record found for remote IP',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "Reverse DNS check (session=session-ptr): FAIL ip='203.0.113.10' - No PTR record found",
      );

      reverseSpy.mockRestore();
    });

    it('fails with ptr-specific error codes from reverse DNS', async () => {
      const reverseSpy = jest
        .spyOn(dns, 'reverse')
        .mockRejectedValue(Object.assign(new Error('no ptr'), { code: 'ENOTFOUND' }));

      const result = await service.verifyReverseDns('203.0.113.11', 'session-ptr-error-code');

      expect(result).toEqual({
        status: 'fail',
        ip: '203.0.113.11',
        info: 'No PTR record found for remote IP',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "Reverse DNS check (session=session-ptr-error-code): FAIL ip='203.0.113.11' - No PTR record (ENOTFOUND)",
      );

      reverseSpy.mockRestore();
    });

    it('fails with generic reverse DNS errors', async () => {
      const reverseSpy = jest.spyOn(dns, 'reverse').mockRejectedValue(new Error('reverse boom'));

      const result = await service.verifyReverseDns('203.0.113.12', 'session-ptr-error-generic');

      expect(result).toEqual({
        status: 'fail',
        ip: '203.0.113.12',
        info: 'reverse boom',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "Reverse DNS check (session=session-ptr-error-generic): ERROR ip='203.0.113.12' - reverse boom",
      );

      reverseSpy.mockRestore();
    });
  });

  describe('logValidationResults', () => {
    it('logs warnings for non-pass SPF, failed DKIM, and failed PTR, and logs DKIM passes', () => {
      logSpy.mockClear();
      warnSpy.mockClear();

      service.logValidationResults(
        'session-logs',
        { status: 'neutral', info: 'meh' },
        [
          { status: 'fail', domain: 'fail.com', selector: 'sel1', info: 'bad sig' },
          { status: 'pass', domain: 'pass.com', selector: 'sel2', info: 'ok' },
        ],
        { status: 'pass', policy: 'reject', info: 'aligned' },
        { status: 'fail', ip: '198.51.100.10', hostname: 'host.example', info: 'mismatch' },
      );

      expect(logSpy).toHaveBeenCalledWith(
        'Validation results (session=session-logs): [SPF=NEUTRAL, DKIM=FAIL,PASS, DMARC=PASS(policy=reject), PTR=FAIL(host.example)]',
      );
      expect(warnSpy).toHaveBeenCalledWith('SPF validation warning (session=session-logs): neutral - meh');
      expect(warnSpy).toHaveBeenCalledWith(
        'DKIM validation failed (session=session-logs): domain=fail.com, selector=sel1 - bad sig',
      );
      expect(logSpy).toHaveBeenCalledWith(
        'DKIM validation passed (session=session-logs): domain=pass.com, selector=sel2',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        'Reverse DNS validation failed (session=session-logs): ip=198.51.100.10 hostname=host.example - mismatch',
      );
    });
  });

  describe('statusToString', () => {
    it('normalizes status inputs regardless of shape', () => {
      const statusToString = (service as unknown as { statusToString: (status?: unknown) => string }).statusToString;

      expect(statusToString('pass')).toBe('pass');
      expect(statusToString({ result: 'fail' })).toBe('fail');
      expect(statusToString({ comment: 'fallback' })).toBe('fallback');
      expect(statusToString(undefined)).toBe('unknown');
    });
  });

  describe('normalizeDmarcPolicy', () => {
    it('normalizes policy strings and handles missing values', () => {
      const normalize = (service as unknown as { normalizeDmarcPolicy: (policy?: string) => string | undefined })
        .normalizeDmarcPolicy;

      expect(normalize(undefined)).toBeUndefined();
      expect(normalize('NONE')).toBe('none');
      expect(normalize('quarantine')).toBe('quarantine');
      expect(normalize('invalid')).toBeUndefined();
    });
  });
});
