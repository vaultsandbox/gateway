import {
  secondsToHours,
  hoursToSeconds,
  secondsToMinutes,
  minutesToSeconds,
  secondsToDays,
  daysToSeconds,
  toSeconds,
  fromSeconds,
  formatUptime,
  formatDuration,
  formatDurationMs,
  TtlUnit,
} from '../time.utils';
import { TIME } from '../../constants/app.constants';

describe('time.utils', () => {
  describe('secondsToHours', () => {
    it('should convert seconds to hours with rounding', () => {
      expect(secondsToHours(3600)).toBe(1);
      expect(secondsToHours(7200)).toBe(2);
      expect(secondsToHours(5400)).toBe(2); // 1.5 hours rounds to 2
      expect(secondsToHours(1800)).toBe(1); // 0.5 hours rounds to 1
      expect(secondsToHours(0)).toBe(0);
    });
  });

  describe('hoursToSeconds', () => {
    it('should convert hours to seconds', () => {
      expect(hoursToSeconds(1)).toBe(3600);
      expect(hoursToSeconds(2)).toBe(7200);
      expect(hoursToSeconds(0)).toBe(0);
      expect(hoursToSeconds(0.5)).toBe(1800);
    });
  });

  describe('secondsToMinutes', () => {
    it('should convert seconds to minutes with rounding', () => {
      expect(secondsToMinutes(60)).toBe(1);
      expect(secondsToMinutes(120)).toBe(2);
      expect(secondsToMinutes(90)).toBe(2); // 1.5 minutes rounds to 2
      expect(secondsToMinutes(30)).toBe(1); // 0.5 minutes rounds to 1
      expect(secondsToMinutes(0)).toBe(0);
    });
  });

  describe('minutesToSeconds', () => {
    it('should convert minutes to seconds', () => {
      expect(minutesToSeconds(1)).toBe(60);
      expect(minutesToSeconds(2)).toBe(120);
      expect(minutesToSeconds(0)).toBe(0);
      expect(minutesToSeconds(0.5)).toBe(30);
    });
  });

  describe('secondsToDays', () => {
    it('should convert seconds to days with rounding', () => {
      expect(secondsToDays(86400)).toBe(1);
      expect(secondsToDays(172800)).toBe(2);
      expect(secondsToDays(129600)).toBe(2); // 1.5 days rounds to 2
      expect(secondsToDays(43200)).toBe(1); // 0.5 days rounds to 1
      expect(secondsToDays(0)).toBe(0);
    });
  });

  describe('daysToSeconds', () => {
    it('should convert days to seconds', () => {
      expect(daysToSeconds(1)).toBe(86400);
      expect(daysToSeconds(2)).toBe(172800);
      expect(daysToSeconds(0)).toBe(0);
      expect(daysToSeconds(0.5)).toBe(43200);
    });
  });

  describe('toSeconds', () => {
    it('should convert minutes to seconds', () => {
      expect(toSeconds(1, 'minutes')).toBe(60);
      expect(toSeconds(5, 'minutes')).toBe(300);
    });

    it('should convert hours to seconds', () => {
      expect(toSeconds(1, 'hours')).toBe(3600);
      expect(toSeconds(2, 'hours')).toBe(7200);
    });

    it('should convert days to seconds', () => {
      expect(toSeconds(1, 'days')).toBe(86400);
      expect(toSeconds(2, 'days')).toBe(172800);
    });

    it('should default to hours for unknown units', () => {
      expect(toSeconds(1, 'unknown' as TtlUnit)).toBe(3600);
    });
  });

  describe('fromSeconds', () => {
    it('should convert seconds to minutes', () => {
      expect(fromSeconds(60, 'minutes')).toBe(1);
      expect(fromSeconds(300, 'minutes')).toBe(5);
    });

    it('should convert seconds to hours', () => {
      expect(fromSeconds(3600, 'hours')).toBe(1);
      expect(fromSeconds(7200, 'hours')).toBe(2);
    });

    it('should convert seconds to days', () => {
      expect(fromSeconds(86400, 'days')).toBe(1);
      expect(fromSeconds(172800, 'days')).toBe(2);
    });

    it('should default to hours for unknown units', () => {
      expect(fromSeconds(3600, 'unknown' as TtlUnit)).toBe(1);
    });
  });

  describe('formatUptime', () => {
    it('should format seconds only', () => {
      expect(formatUptime(45)).toBe('45s');
    });

    it('should format minutes and seconds', () => {
      expect(formatUptime(125)).toBe('2m 5s');
    });

    it('should format hours, minutes, and seconds', () => {
      expect(formatUptime(3725)).toBe('1h 2m 5s');
    });

    it('should format days, hours, minutes, and seconds', () => {
      expect(formatUptime(90125)).toBe('1d 1h 2m 5s');
    });

    it('should omit zero-value parts', () => {
      expect(formatUptime(3600)).toBe('1h');
      expect(formatUptime(86400)).toBe('1d');
      expect(formatUptime(3660)).toBe('1h 1m');
    });

    it('should show 0s for zero input', () => {
      expect(formatUptime(0)).toBe('0s');
    });

    it('should handle exact day boundary', () => {
      expect(formatUptime(TIME.SECONDS_PER_DAY)).toBe('1d');
    });

    it('should handle exact hour boundary', () => {
      expect(formatUptime(TIME.SECONDS_PER_HOUR)).toBe('1h');
    });

    it('should handle exact minute boundary', () => {
      expect(formatUptime(TIME.SECONDS_PER_MINUTE)).toBe('1m');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(30)).toBe('30s');
      expect(formatDuration(59)).toBe('59s');
    });

    it('should format minutes', () => {
      expect(formatDuration(60)).toBe('1m');
      expect(formatDuration(120)).toBe('2m');
      expect(formatDuration(3599)).toBe('59m');
    });

    it('should format hours', () => {
      expect(formatDuration(3600)).toBe('1h');
      expect(formatDuration(7200)).toBe('2h');
      expect(formatDuration(86399)).toBe('23h');
    });

    it('should format days', () => {
      expect(formatDuration(86400)).toBe('1d');
      expect(formatDuration(172800)).toBe('2d');
    });
  });

  describe('formatDurationMs', () => {
    it('should convert milliseconds and format', () => {
      expect(formatDurationMs(30000)).toBe('30s');
      expect(formatDurationMs(60000)).toBe('1m');
      expect(formatDurationMs(3600000)).toBe('1h');
      expect(formatDurationMs(86400000)).toBe('1d');
    });

    it('should floor milliseconds before conversion', () => {
      expect(formatDurationMs(30500)).toBe('30s');
      expect(formatDurationMs(59999)).toBe('59s');
    });
  });
});
