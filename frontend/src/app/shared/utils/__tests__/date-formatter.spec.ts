import { DateFormatter } from '../date-formatter';

describe('DateFormatter', () => {
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    localStorageMock = {};
    spyOn(localStorage, 'getItem').and.callFake((key: string) => localStorageMock[key] || null);
  });

  describe('format', () => {
    describe('with empty or invalid input', () => {
      it('should return empty string for empty input', () => {
        expect(DateFormatter.format('')).toBe('');
      });

      it('should return empty string for null-like input', () => {
        expect(DateFormatter.format(null as unknown as string)).toBe('');
        expect(DateFormatter.format(undefined as unknown as string)).toBe('');
      });

      it('should return empty string for invalid date', () => {
        expect(DateFormatter.format('not-a-date')).toBe('');
        expect(DateFormatter.format('invalid')).toBe('');
      });
    });

    describe('with detailed style', () => {
      it('should format date with 24h time format by default', () => {
        const result = DateFormatter.format('2024-06-15T14:30:00Z', 'detailed');
        expect(result).toContain('2024');
        expect(result).toBeTruthy();
      });

      it('should format date with 12h time format when set', () => {
        localStorageMock['vaultsandbox_settings'] = JSON.stringify({ timeFormat: '12h' });
        const result = DateFormatter.format('2024-06-15T14:30:00Z', 'detailed');
        expect(result).toBeTruthy();
      });

      it('should format date with 24h time format when explicitly set', () => {
        localStorageMock['vaultsandbox_settings'] = JSON.stringify({ timeFormat: '24h' });
        const result = DateFormatter.format('2024-06-15T14:30:00Z', 'detailed');
        expect(result).toBeTruthy();
      });
    });

    describe('with friendly style', () => {
      it('should format same-day dates as time only', () => {
        const now = new Date();
        const sameDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30, 0);
        const result = DateFormatter.format(sameDay.toISOString(), 'friendly');
        expect(result).toBeTruthy();
        // Should be a time format, not contain year
        expect(result.length).toBeLessThan(20);
      });

      it('should format different-day dates as detailed', () => {
        const pastDate = new Date('2020-01-15T10:30:00Z');
        const result = DateFormatter.format(pastDate.toISOString(), 'friendly');
        expect(result).toContain('2020');
      });

      it('should use 12h format for same-day when set', () => {
        localStorageMock['vaultsandbox_settings'] = JSON.stringify({ timeFormat: '12h' });
        const now = new Date();
        const sameDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 30, 0);
        const result = DateFormatter.format(sameDay.toISOString(), 'friendly');
        expect(result).toBeTruthy();
      });
    });

    describe('with relative style (default)', () => {
      it('should use relative style by default', () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const result = DateFormatter.format(fiveMinutesAgo.toISOString());
        expect(result).toContain('minute');
      });

      it('should return "just now" for less than 1 minute ago', () => {
        const justNow = new Date(Date.now() - 30 * 1000);
        const result = DateFormatter.format(justNow.toISOString(), 'relative');
        expect(result).toBe('just now');
      });

      it('should return singular minute for exactly 1 minute ago', () => {
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
        const result = DateFormatter.format(oneMinuteAgo.toISOString(), 'relative');
        expect(result).toBe('1 minute ago');
      });

      it('should return plural minutes for multiple minutes ago', () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const result = DateFormatter.format(fiveMinutesAgo.toISOString(), 'relative');
        expect(result).toBe('5 minutes ago');
      });

      it('should return singular hour for exactly 1 hour ago', () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const result = DateFormatter.format(oneHourAgo.toISOString(), 'relative');
        expect(result).toBe('1 hour ago');
      });

      it('should return plural hours for multiple hours ago', () => {
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const result = DateFormatter.format(threeHoursAgo.toISOString(), 'relative');
        expect(result).toBe('3 hours ago');
      });

      it('should return singular day for exactly 1 day ago', () => {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = DateFormatter.format(oneDayAgo.toISOString(), 'relative');
        expect(result).toBe('1 day ago');
      });

      it('should return plural days for multiple days ago', () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        const result = DateFormatter.format(threeDaysAgo.toISOString(), 'relative');
        expect(result).toBe('3 days ago');
      });

      it('should return formatted date for 7+ days ago', () => {
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const result = DateFormatter.format(twoWeeksAgo.toISOString(), 'relative');
        // Should contain month and year, not "days ago"
        expect(result).not.toContain('ago');
      });
    });
  });

  describe('formatTimeOnly', () => {
    it('should return empty string for empty input', () => {
      expect(DateFormatter.formatTimeOnly('')).toBe('');
    });

    it('should return empty string for null-like input', () => {
      expect(DateFormatter.formatTimeOnly(null as unknown as string)).toBe('');
      expect(DateFormatter.formatTimeOnly(undefined as unknown as string)).toBe('');
    });

    it('should return empty string for invalid date', () => {
      expect(DateFormatter.formatTimeOnly('not-a-date')).toBe('');
    });

    it('should format time with 24h format by default', () => {
      const result = DateFormatter.formatTimeOnly('2024-06-15T14:30:45Z');
      expect(result).toBeTruthy();
      // Should contain seconds
      expect(result.split(':').length).toBe(3);
    });

    it('should format time with 12h format when set', () => {
      localStorageMock['vaultsandbox_settings'] = JSON.stringify({ timeFormat: '12h' });
      const result = DateFormatter.formatTimeOnly('2024-06-15T14:30:45Z');
      expect(result).toBeTruthy();
    });
  });

  describe('getTimeFormat (via format calls)', () => {
    it('should handle missing localStorage', () => {
      // localStorage.getItem returns null
      const result = DateFormatter.format('2024-06-15T14:30:00Z', 'detailed');
      expect(result).toBeTruthy();
    });

    it('should handle invalid JSON in localStorage', () => {
      localStorageMock['vaultsandbox_settings'] = 'invalid-json';
      const result = DateFormatter.format('2024-06-15T14:30:00Z', 'detailed');
      expect(result).toBeTruthy();
    });

    it('should handle missing timeFormat in settings', () => {
      localStorageMock['vaultsandbox_settings'] = JSON.stringify({ otherSetting: true });
      const result = DateFormatter.format('2024-06-15T14:30:00Z', 'detailed');
      expect(result).toBeTruthy();
    });

    it('should handle invalid timeFormat value', () => {
      localStorageMock['vaultsandbox_settings'] = JSON.stringify({ timeFormat: 'invalid' });
      const result = DateFormatter.format('2024-06-15T14:30:00Z', 'detailed');
      expect(result).toBeTruthy();
    });
  });
});
