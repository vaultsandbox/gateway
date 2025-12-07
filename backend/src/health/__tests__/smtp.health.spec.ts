import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { SmtpHealthIndicator } from './../smtp.health';
import { SmtpService } from '../../smtp/smtp.service';

describe('SmtpHealthIndicator', () => {
  let indicator: SmtpHealthIndicator;
  let smtpService: jest.Mocked<SmtpService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmtpHealthIndicator,
        HealthIndicatorService,
        {
          provide: SmtpService,
          useValue: {
            isListening: jest.fn(),
          },
        },
      ],
    }).compile();

    indicator = module.get<SmtpHealthIndicator>(SmtpHealthIndicator);
    smtpService = module.get(SmtpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(indicator).toBeDefined();
  });

  describe('isHealthy', () => {
    it('should return healthy status when SMTP service is listening', async () => {
      smtpService.isListening.mockReturnValue(true);

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({
        smtp: {
          status: 'up',
          listening: true,
        },
      });
      expect(smtpService.isListening).toHaveBeenCalledTimes(1);
    });

    it('should return down status when SMTP service is not listening', async () => {
      smtpService.isListening.mockReturnValue(false);

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({
        smtp: {
          status: 'down',
          listening: false,
        },
      });
      expect(smtpService.isListening).toHaveBeenCalledTimes(1);
    });

    it('should include correct status when SMTP is down', async () => {
      smtpService.isListening.mockReturnValue(false);

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({
        smtp: {
          status: 'down',
          listening: false,
        },
      });
    });

    it('should use custom key in health result', async () => {
      const customKey = 'my-smtp-server';
      smtpService.isListening.mockReturnValue(true);

      const result = await indicator.isHealthy(customKey);

      expect(result).toEqual({
        [customKey]: {
          status: 'up',
          listening: true,
        },
      });
    });

    it('should use custom key in down result when SMTP is down', async () => {
      const customKey = 'my-smtp-server';
      smtpService.isListening.mockReturnValue(false);

      const result = await indicator.isHealthy(customKey);

      expect(result).toEqual({
        [customKey]: {
          status: 'down',
          listening: false,
        },
      });
    });
  });
});
