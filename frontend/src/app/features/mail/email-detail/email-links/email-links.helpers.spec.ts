import { EmailLinksHelpers, LinkValidationStatus } from './email-links.helpers';

describe('EmailLinksHelpers', () => {
  describe('getLinkIcon', () => {
    it('returns envelope icon for mailto links', () => {
      expect(EmailLinksHelpers.getLinkIcon('mailto:test@example.com')).toBe('pi pi-envelope text-blue-500');
    });

    it('returns envelope icon for mailto links (case insensitive)', () => {
      expect(EmailLinksHelpers.getLinkIcon('MAILTO:test@example.com')).toBe('pi pi-envelope text-blue-500');
    });

    it('returns lock icon for https links', () => {
      expect(EmailLinksHelpers.getLinkIcon('https://example.com')).toBe('pi pi-lock text-green-500');
    });

    it('returns lock icon for https links (case insensitive)', () => {
      expect(EmailLinksHelpers.getLinkIcon('HTTPS://example.com')).toBe('pi pi-lock text-green-500');
    });

    it('returns globe icon for http links', () => {
      expect(EmailLinksHelpers.getLinkIcon('http://example.com')).toBe('pi pi-globe text-orange-500');
    });

    it('returns globe icon for http links (case insensitive)', () => {
      expect(EmailLinksHelpers.getLinkIcon('HTTP://example.com')).toBe('pi pi-globe text-orange-500');
    });

    it('returns server icon for ftp links', () => {
      expect(EmailLinksHelpers.getLinkIcon('ftp://example.com')).toBe('pi pi-server text-purple-500');
    });

    it('returns server icon for ftp links (case insensitive)', () => {
      expect(EmailLinksHelpers.getLinkIcon('FTP://example.com')).toBe('pi pi-server text-purple-500');
    });

    it('returns generic link icon for unknown schemes', () => {
      expect(EmailLinksHelpers.getLinkIcon('file:///path/to/file')).toBe('pi pi-link text-surface-500');
      expect(EmailLinksHelpers.getLinkIcon('unknown://something')).toBe('pi pi-link text-surface-500');
    });
  });

  describe('getLinkType', () => {
    it('returns Email for mailto links', () => {
      expect(EmailLinksHelpers.getLinkType('mailto:test@example.com')).toBe('Email');
    });

    it('returns Email for mailto links (case insensitive)', () => {
      expect(EmailLinksHelpers.getLinkType('MAILTO:test@example.com')).toBe('Email');
    });

    it('returns HTTPS for https links', () => {
      expect(EmailLinksHelpers.getLinkType('https://example.com')).toBe('HTTPS');
    });

    it('returns HTTPS for https links (case insensitive)', () => {
      expect(EmailLinksHelpers.getLinkType('HTTPS://example.com')).toBe('HTTPS');
    });

    it('returns HTTP for http links', () => {
      expect(EmailLinksHelpers.getLinkType('http://example.com')).toBe('HTTP');
    });

    it('returns HTTP for http links (case insensitive)', () => {
      expect(EmailLinksHelpers.getLinkType('HTTP://example.com')).toBe('HTTP');
    });

    it('returns FTP for ftp links', () => {
      expect(EmailLinksHelpers.getLinkType('ftp://example.com')).toBe('FTP');
    });

    it('returns FTP for ftp links (case insensitive)', () => {
      expect(EmailLinksHelpers.getLinkType('FTP://example.com')).toBe('FTP');
    });

    it('returns Link for unknown schemes', () => {
      expect(EmailLinksHelpers.getLinkType('file:///path/to/file')).toBe('Link');
      expect(EmailLinksHelpers.getLinkType('unknown://something')).toBe('Link');
    });
  });

  describe('getStatusBadgeClass', () => {
    const baseClasses = 'px-2 py-1 rounded text-xs font-medium flex items-center gap-1 whitespace-nowrap';

    it('returns blue classes for checking status', () => {
      expect(EmailLinksHelpers.getStatusBadgeClass('checking')).toBe(
        `${baseClasses} bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200`,
      );
    });

    it('returns green classes for valid status', () => {
      expect(EmailLinksHelpers.getStatusBadgeClass('valid')).toBe(
        `${baseClasses} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`,
      );
    });

    it('returns red classes for invalid status', () => {
      expect(EmailLinksHelpers.getStatusBadgeClass('invalid')).toBe(
        `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`,
      );
    });

    it('returns red classes for error status', () => {
      expect(EmailLinksHelpers.getStatusBadgeClass('error')).toBe(
        `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`,
      );
    });

    it('returns surface classes for unchecked status', () => {
      expect(EmailLinksHelpers.getStatusBadgeClass('unchecked')).toBe(
        `${baseClasses} bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-200`,
      );
    });
  });

  describe('getStatusIcon', () => {
    it('returns spinner icon for checking status', () => {
      expect(EmailLinksHelpers.getStatusIcon('checking')).toBe('pi pi-spinner pi-spin');
    });

    it('returns check-circle icon for valid status', () => {
      expect(EmailLinksHelpers.getStatusIcon('valid')).toBe('pi pi-check-circle');
    });

    it('returns times-circle icon for invalid status', () => {
      expect(EmailLinksHelpers.getStatusIcon('invalid')).toBe('pi pi-times-circle');
    });

    it('returns times-circle icon for error status', () => {
      expect(EmailLinksHelpers.getStatusIcon('error')).toBe('pi pi-times-circle');
    });

    it('returns question-circle icon for unchecked status', () => {
      expect(EmailLinksHelpers.getStatusIcon('unchecked')).toBe('pi pi-question-circle');
    });
  });

  describe('getStatusLabel', () => {
    it('returns "Checking..." for checking status', () => {
      expect(EmailLinksHelpers.getStatusLabel('checking')).toBe('Checking...');
    });

    it('returns "Valid" for valid status', () => {
      expect(EmailLinksHelpers.getStatusLabel('valid')).toBe('Valid');
    });

    it('returns "Invalid" for invalid status', () => {
      expect(EmailLinksHelpers.getStatusLabel('invalid')).toBe('Invalid');
    });

    it('returns "Error" for error status', () => {
      expect(EmailLinksHelpers.getStatusLabel('error')).toBe('Error');
    });

    it('returns "Unchecked" for unchecked status', () => {
      expect(EmailLinksHelpers.getStatusLabel('unchecked')).toBe('Unchecked');
    });
  });

  describe('getStatusTooltip', () => {
    it('returns error message when present', () => {
      const linkStatus: LinkValidationStatus = {
        url: 'https://example.com',
        status: 'error',
        error: 'Connection refused',
      };
      expect(EmailLinksHelpers.getStatusTooltip(linkStatus)).toBe('Connection refused');
    });

    it('returns HTTP status code when present and no error', () => {
      const linkStatus: LinkValidationStatus = {
        url: 'https://example.com',
        status: 'valid',
        statusCode: 200,
      };
      expect(EmailLinksHelpers.getStatusTooltip(linkStatus)).toBe('HTTP 200');
    });

    it('returns status label when no error or status code', () => {
      const linkStatus: LinkValidationStatus = {
        url: 'https://example.com',
        status: 'unchecked',
      };
      expect(EmailLinksHelpers.getStatusTooltip(linkStatus)).toBe('Unchecked');
    });

    it('prioritizes error over statusCode', () => {
      const linkStatus: LinkValidationStatus = {
        url: 'https://example.com',
        status: 'error',
        statusCode: 500,
        error: 'Server error',
      };
      expect(EmailLinksHelpers.getStatusTooltip(linkStatus)).toBe('Server error');
    });
  });

  describe('truncateUrl', () => {
    it('returns original URL when shorter than maxLength', () => {
      expect(EmailLinksHelpers.truncateUrl('https://example.com', 50)).toBe('https://example.com');
    });

    it('returns original URL when equal to maxLength', () => {
      const url = 'https://example.com/path';
      expect(EmailLinksHelpers.truncateUrl(url, url.length)).toBe(url);
    });

    it('truncates URL with ellipsis when longer than maxLength', () => {
      expect(EmailLinksHelpers.truncateUrl('https://example.com/very/long/path/to/resource', 30)).toBe(
        'https://example.com/very/lo...',
      );
    });

    it('handles very short maxLength', () => {
      expect(EmailLinksHelpers.truncateUrl('https://example.com', 10)).toBe('https:/...');
    });
  });
});
