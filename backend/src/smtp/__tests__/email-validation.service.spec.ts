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
    it('returns default result when the domain is missing', async () => {
      const result = await service.verifySpf(undefined, '192.0.2.5', 'sender@example.com', 'session-default');

      expect(result).toEqual({
        status: 'none',
        domain: undefined,
        ip: '192.0.2.5',
        info: 'SPF check skipped',
      });
      expect(mockedSpf).not.toHaveBeenCalled();
    });

    it('returns default result when the remote IP is missing', async () => {
      const result = await service.verifySpf('example.com', undefined, 'sender@example.com', 'session-no-ip');

      expect(result).toEqual({
        status: 'none',
        domain: 'example.com',
        ip: undefined,
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

    it('returns temperror with timeout message when the SPF lookup times out', async () => {
      mockedSpf.mockRejectedValue(new Error('SPF lookup timed out after 5000ms'));

      const result = await service.verifySpf('example.com', '192.0.2.1', 'sender@example.com', 'session-timeout');

      expect(result).toEqual({
        status: 'temperror',
        domain: 'example.com',
        ip: '192.0.2.1',
        info: 'DNS lookup timed out after 5000ms',
      });
    });

    it('falls back to statusObj.comment when result.info is missing', async () => {
      mockedSpf.mockResolvedValue({
        status: { result: 'pass', comment: 'comment fallback' },
      } as never);

      const result = await service.verifySpf('example.com', '192.0.2.1', 'sender@example.com', 'session-comment');

      expect(result).toEqual({
        status: 'pass',
        domain: 'example.com',
        ip: '192.0.2.1',
        info: 'comment fallback',
      });
    });

    it('falls back to statusToString when both info and comment are missing', async () => {
      mockedSpf.mockResolvedValue({
        status: { result: 'softfail' },
      } as never);

      const result = await service.verifySpf('example.com', '192.0.2.1', 'sender@example.com', 'session-fallback');

      expect(result).toEqual({
        status: 'softfail',
        domain: 'example.com',
        ip: '192.0.2.1',
        info: 'softfail',
      });
    });

    it('handles status as a non-object (string-like)', async () => {
      mockedSpf.mockResolvedValue({
        status: 'neutral',
        info: 'neutral info',
      } as never);

      const result = await service.verifySpf('example.com', '192.0.2.1', 'sender@example.com', 'session-string');

      expect(result).toEqual({
        status: 'none',
        domain: 'example.com',
        ip: '192.0.2.1',
        info: 'neutral info',
      });
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

    it('returns none when dkimResult is null', async () => {
      mockedDkimVerify.mockResolvedValue(null as never);

      const result = await service.verifyDkim(Buffer.from('raw'), 'session-null');

      expect(result).toEqual([
        {
          status: 'none',
          info: 'No DKIM signatures found in email',
        },
      ]);
    });

    it('returns none when dkimResult.results is undefined', async () => {
      mockedDkimVerify.mockResolvedValue({} as never);

      const result = await service.verifyDkim(Buffer.from('raw'), 'session-no-results');

      expect(result).toEqual([
        {
          status: 'none',
          info: 'No DKIM signatures found in email',
        },
      ]);
    });

    it('returns timeout message when DKIM verification times out', async () => {
      mockedDkimVerify.mockRejectedValue(new Error('DKIM verification timed out after 5000ms'));

      const result = await service.verifyDkim(Buffer.from('raw'), 'session-timeout');

      expect(result).toEqual([
        {
          status: 'none',
          info: 'DNS lookup timed out after 5000ms',
        },
      ]);
    });

    it('falls back to statusObj.comment when info is missing', async () => {
      mockedDkimVerify.mockResolvedValue({
        results: [
          { status: { result: 'pass', comment: 'good signature' }, signingDomain: 'example.com', selector: 'sel1' },
        ],
      } as never);

      const result = await service.verifyDkim(Buffer.from('raw'), 'session-comment');

      expect(result).toEqual([{ status: 'pass', domain: 'example.com', selector: 'sel1', info: 'good signature' }]);
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

    it('returns timeout message when DMARC lookup times out', async () => {
      mockedDmarc.mockRejectedValue(new Error('DMARC lookup timed out after 5000ms'));

      const result = await service.verifyDmarc(headersWithFrom, spfResult, dkimResults, 'session-timeout');

      expect(result).toEqual({
        status: 'none',
        info: 'DNS lookup timed out after 5000ms',
      });
    });

    it('uses p property as fallback when policy is missing', async () => {
      mockedDmarc.mockResolvedValue({
        status: { result: 'pass' },
        p: 'reject',
        alignment: { spf: { result: 'pass' } },
        domain: 'example.com',
      } as never);

      const result = await service.verifyDmarc(headersWithFrom, spfResult, dkimResults, 'session-p');

      expect(result.policy).toBe('reject');
    });

    it('sets aligned true when dkim alignment passes but spf does not', async () => {
      mockedDmarc.mockResolvedValue({
        status: { result: 'pass' },
        policy: 'none',
        alignment: { dkim: { result: 'pass' } },
        domain: 'example.com',
      } as never);

      const result = await service.verifyDmarc(headersWithFrom, undefined, dkimResults, 'session-dkim-align');

      expect(result.aligned).toBe(true);
    });

    it('handles From header without angle brackets', async () => {
      mockedDmarc.mockResolvedValue({
        status: { result: 'pass' },
        domain: 'simple.com',
      } as never);

      const result = await service.verifyDmarc({ from: 'user@simple.com' }, undefined, undefined, 'session-simple');

      expect(result.status).toBe('pass');
    });

    it('falls back to statusObj.comment when info is missing', async () => {
      mockedDmarc.mockResolvedValue({
        status: { result: 'pass', comment: 'dmarc comment' },
        domain: 'example.com',
      } as never);

      const result = await service.verifyDmarc(headersWithFrom, spfResult, dkimResults, 'session-comment');

      expect(result.info).toBe('dmarc comment');
    });

    it('handles status as non-object value', async () => {
      mockedDmarc.mockResolvedValue({
        status: 'weird',
        domain: 'example.com',
      } as never);

      const result = await service.verifyDmarc(headersWithFrom, spfResult, dkimResults, 'session-weird');

      expect(result.status).toBe('none');
    });

    it('logs with fallback info when domain is unknown and status is pass', async () => {
      mockedDmarc.mockResolvedValue({
        status: { result: 'pass' },
        alignment: { spf: { result: 'pass' } },
      } as never);

      await service.verifyDmarc(headersWithFrom, spfResult, dkimResults, 'session-nodomain');

      expect(logSpy).toHaveBeenCalledWith(
        "DMARC check (session=session-nodomain): PASS for domain='unknown' policy=none aligned=true",
      );
    });

    it('logs with Alignment failure fallback when status is fail and info is missing', async () => {
      mockedDmarc.mockResolvedValue({
        status: { result: 'fail' },
      } as never);

      await service.verifyDmarc(headersWithFrom, undefined, undefined, 'session-fail-noinfo');

      expect(warnSpy).toHaveBeenCalledWith(
        'DMARC validation failed (session=session-fail-noinfo): domain=unknown policy=none aligned=false - Alignment failure',
      );
    });

    it('logs with No DMARC policy fallback when status is none and info is missing', async () => {
      mockedDmarc.mockResolvedValue({
        status: { result: 'other' },
      } as never);

      await service.verifyDmarc(headersWithFrom, undefined, undefined, 'session-none-noinfo');

      expect(logSpy).toHaveBeenCalledWith(
        "DMARC check (session=session-none-noinfo): NONE for domain='unknown' - No DMARC policy",
      );
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

    it('fails with ENODATA error code', async () => {
      const reverseSpy = jest
        .spyOn(dns, 'reverse')
        .mockRejectedValue(Object.assign(new Error('no data'), { code: 'ENODATA' }));

      const result = await service.verifyReverseDns('203.0.113.13', 'session-enodata');

      expect(result).toEqual({
        status: 'fail',
        ip: '203.0.113.13',
        info: 'No PTR record found for remote IP',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "Reverse DNS check (session=session-enodata): FAIL ip='203.0.113.13' - No PTR record (ENODATA)",
      );

      reverseSpy.mockRestore();
    });

    it('fails with NXDOMAIN error code', async () => {
      const reverseSpy = jest
        .spyOn(dns, 'reverse')
        .mockRejectedValue(Object.assign(new Error('no domain'), { code: 'NXDOMAIN' }));

      const result = await service.verifyReverseDns('203.0.113.14', 'session-nxdomain');

      expect(result).toEqual({
        status: 'fail',
        ip: '203.0.113.14',
        info: 'No PTR record found for remote IP',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "Reverse DNS check (session=session-nxdomain): FAIL ip='203.0.113.14' - No PTR record (NXDOMAIN)",
      );

      reverseSpy.mockRestore();
    });

    it('continues checking other hostnames when forward lookup fails', async () => {
      const debugSpy = jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
      const reverseSpy = jest.spyOn(dns, 'reverse').mockResolvedValue(['bad.example', 'good.example']);
      const lookupSpy = jest
        .spyOn(dns, 'lookup')
        .mockRejectedValueOnce(new Error('lookup failed'))
        .mockResolvedValueOnce([{ address: '203.0.113.15' } as LookupAddress]);

      const result = await service.verifyReverseDns('203.0.113.15', 'session-forward-fail');

      expect(result).toEqual({
        status: 'pass',
        ip: '203.0.113.15',
        hostname: 'good.example',
        info: 'PTR hostname resolves back to originating IP',
      });
      expect(debugSpy).toHaveBeenCalledWith(
        "Forward lookup error (session=session-forward-fail) for hostname='bad.example': lookup failed",
      );

      reverseSpy.mockRestore();
      lookupSpy.mockRestore();
      debugSpy.mockRestore();
    });

    it('returns fail when all forward lookups fail', async () => {
      const debugSpy = jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
      const reverseSpy = jest.spyOn(dns, 'reverse').mockResolvedValue(['host1.example', 'host2.example']);
      const lookupSpy = jest.spyOn(dns, 'lookup').mockRejectedValue(new Error('all lookups fail'));

      const result = await service.verifyReverseDns('203.0.113.16', 'session-all-fail');

      expect(result).toEqual({
        status: 'fail',
        ip: '203.0.113.16',
        hostname: 'host1.example',
        info: 'PTR hostname does not resolve back to originating IP',
      });

      reverseSpy.mockRestore();
      lookupSpy.mockRestore();
      debugSpy.mockRestore();
    });

    it('handles error without message property', async () => {
      const reverseSpy = jest.spyOn(dns, 'reverse').mockRejectedValue({ code: 'UNKNOWN' });

      const result = await service.verifyReverseDns('203.0.113.17', 'session-no-message');

      expect(result).toEqual({
        status: 'fail',
        ip: '203.0.113.17',
        info: '[object Object]',
      });

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

    it('logs with defaults when all results are undefined', () => {
      logSpy.mockClear();

      service.logValidationResults('session-empty');

      expect(logSpy).toHaveBeenCalledWith(
        'Validation results (session=session-empty): [SPF=none, DKIM=none, DMARC=none, PTR=none]',
      );
    });

    it('logs without policy when dmarc policy is missing', () => {
      logSpy.mockClear();

      service.logValidationResults('session-no-policy', undefined, undefined, { status: 'pass' });

      expect(logSpy).toHaveBeenCalledWith(
        'Validation results (session=session-no-policy): [SPF=none, DKIM=none, DMARC=PASS, PTR=none]',
      );
    });

    it('logs without hostname when ptr hostname is missing', () => {
      logSpy.mockClear();
      warnSpy.mockClear();

      service.logValidationResults('session-no-hostname', undefined, undefined, undefined, {
        status: 'fail',
        ip: '192.0.2.1',
      });

      expect(logSpy).toHaveBeenCalledWith(
        'Validation results (session=session-no-hostname): [SPF=none, DKIM=none, DMARC=none, PTR=FAIL]',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        'Reverse DNS validation failed (session=session-no-hostname): ip=192.0.2.1 hostname=n/a - No additional details',
      );
    });

    it('does not warn for passing SPF result', () => {
      logSpy.mockClear();
      warnSpy.mockClear();

      service.logValidationResults('session-pass', { status: 'pass', info: 'ok' });

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('SPF validation warning'));
    });

    it('handles DKIM results with none status', () => {
      logSpy.mockClear();
      warnSpy.mockClear();

      service.logValidationResults('session-dkim-none', undefined, [{ status: 'none', info: 'no sig' }]);

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('DKIM validation passed'));
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('DKIM validation failed'));
    });

    it('does not warn for passing ptr result', () => {
      warnSpy.mockClear();

      service.logValidationResults('session-ptr-pass', undefined, undefined, undefined, {
        status: 'pass',
        ip: '192.0.2.1',
        hostname: 'mail.example.com',
      });

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Reverse DNS validation failed'));
    });
  });

  describe('statusToString', () => {
    it('normalizes status inputs regardless of shape', () => {
      const statusToString = (
        service as unknown as { statusToString: (status?: unknown) => string }
      ).statusToString.bind(service);

      expect(statusToString('pass')).toBe('pass');
      expect(statusToString({ result: 'fail' })).toBe('fail');
      expect(statusToString({ comment: 'fallback' })).toBe('fallback');
      expect(statusToString({})).toBe('unknown');
      expect(statusToString(undefined)).toBe('unknown');
    });
  });

  describe('normalizeDmarcPolicy', () => {
    it('normalizes policy strings and handles missing values', () => {
      const normalize = (
        service as unknown as { normalizeDmarcPolicy: (policy?: string) => string | undefined }
      ).normalizeDmarcPolicy.bind(service);

      expect(normalize(undefined)).toBeUndefined();
      expect(normalize('NONE')).toBe('none');
      expect(normalize('quarantine')).toBe('quarantine');
      expect(normalize('reject')).toBe('reject');
      expect(normalize('invalid')).toBeUndefined();
    });
  });
});
