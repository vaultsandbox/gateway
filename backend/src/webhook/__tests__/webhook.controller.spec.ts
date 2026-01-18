import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from '../webhook.controller';
import { WebhookService } from '../services/webhook.service';
import { CreateWebhookDto } from '../dto/create-webhook.dto';
import { UpdateWebhookDto } from '../dto/update-webhook.dto';
import { ApiKeyGuard } from '../../inbox/guards/api-key.guard';

describe('WebhookController', () => {
  let controller: WebhookController;
  let webhookService: jest.Mocked<WebhookService>;

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const mockWebhookResponse = {
    id: 'whk_test123',
    url: 'https://example.com/webhook',
    events: ['email.received'],
    scope: 'global' as const,
    enabled: true,
    secret: 'test-secret',
    createdAt: new Date().toISOString(),
  };

  const mockWebhookListResponse = {
    webhooks: [mockWebhookResponse],
    total: 1,
  };

  const mockTestResponse = {
    success: true,
    statusCode: 200,
    responseTime: 100,
    payloadSent: {},
  };

  const mockRotateSecretResponse = {
    id: 'whk_test123',
    secret: 'new-secret',
    previousSecretValidUntil: new Date().toISOString(),
  };

  const mockMetricsResponse = {
    webhooks: { global: 1, inbox: 2, enabled: 3, total: 3 },
    deliveries: { total: 100, successful: 90, failed: 10 },
  };

  const mockTemplatesResponse = {
    templates: [{ label: 'Default', value: 'default' }],
  };

  beforeEach(async () => {
    const mockService = {
      createGlobalWebhook: jest.fn().mockReturnValue(mockWebhookResponse),
      listGlobalWebhooks: jest.fn().mockReturnValue(mockWebhookListResponse),
      getGlobalWebhook: jest.fn().mockReturnValue(mockWebhookResponse),
      updateGlobalWebhook: jest.fn().mockReturnValue(mockWebhookResponse),
      deleteGlobalWebhook: jest.fn(),
      testGlobalWebhook: jest.fn().mockResolvedValue(mockTestResponse),
      rotateGlobalWebhookSecret: jest.fn().mockReturnValue(mockRotateSecretResponse),
      createInboxWebhook: jest.fn().mockReturnValue(mockWebhookResponse),
      listInboxWebhooks: jest.fn().mockReturnValue(mockWebhookListResponse),
      getInboxWebhook: jest.fn().mockReturnValue(mockWebhookResponse),
      updateInboxWebhook: jest.fn().mockReturnValue(mockWebhookResponse),
      deleteInboxWebhook: jest.fn(),
      testInboxWebhook: jest.fn().mockResolvedValue(mockTestResponse),
      rotateInboxWebhookSecret: jest.fn().mockReturnValue(mockRotateSecretResponse),
      getMetrics: jest.fn().mockReturnValue(mockMetricsResponse),
      getTemplates: jest.fn().mockReturnValue(mockTemplatesResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [{ provide: WebhookService, useValue: mockService }],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<WebhookController>(WebhookController);
    webhookService = module.get(WebhookService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Global Webhooks', () => {
    describe('createGlobalWebhook', () => {
      it('should create a global webhook', () => {
        const dto: CreateWebhookDto = {
          url: 'https://example.com/webhook',
          events: ['email.received'],
        };

        const result = controller.createGlobalWebhook(dto);

        expect(webhookService.createGlobalWebhook).toHaveBeenCalledWith(dto);
        expect(result).toEqual(mockWebhookResponse);
      });
    });

    describe('listGlobalWebhooks', () => {
      it('should list all global webhooks', () => {
        const result = controller.listGlobalWebhooks();

        expect(webhookService.listGlobalWebhooks).toHaveBeenCalled();
        expect(result).toEqual(mockWebhookListResponse);
      });
    });

    describe('getWebhookMetrics', () => {
      it('should return webhook metrics', () => {
        const result = controller.getWebhookMetrics();

        expect(webhookService.getMetrics).toHaveBeenCalled();
        expect(result).toEqual(mockMetricsResponse);
      });
    });

    describe('getWebhookTemplates', () => {
      it('should return available templates', () => {
        const result = controller.getWebhookTemplates();

        expect(webhookService.getTemplates).toHaveBeenCalled();
        expect(result).toEqual(mockTemplatesResponse);
      });
    });

    describe('getGlobalWebhook', () => {
      it('should return a global webhook by ID', () => {
        const result = controller.getGlobalWebhook('whk_test123');

        expect(webhookService.getGlobalWebhook).toHaveBeenCalledWith('whk_test123');
        expect(result).toEqual(mockWebhookResponse);
      });
    });

    describe('updateGlobalWebhook', () => {
      it('should update a global webhook', () => {
        const dto: UpdateWebhookDto = { enabled: false };

        const result = controller.updateGlobalWebhook('whk_test123', dto);

        expect(webhookService.updateGlobalWebhook).toHaveBeenCalledWith('whk_test123', dto);
        expect(result).toEqual(mockWebhookResponse);
      });
    });

    describe('deleteGlobalWebhook', () => {
      it('should delete a global webhook', () => {
        controller.deleteGlobalWebhook('whk_test123');

        expect(webhookService.deleteGlobalWebhook).toHaveBeenCalledWith('whk_test123');
      });
    });

    describe('testGlobalWebhook', () => {
      it('should test a global webhook', async () => {
        const result = await controller.testGlobalWebhook('whk_test123');

        expect(webhookService.testGlobalWebhook).toHaveBeenCalledWith('whk_test123');
        expect(result).toEqual(mockTestResponse);
      });
    });

    describe('rotateGlobalWebhookSecret', () => {
      it('should rotate the secret for a global webhook', () => {
        const result = controller.rotateGlobalWebhookSecret('whk_test123');

        expect(webhookService.rotateGlobalWebhookSecret).toHaveBeenCalledWith('whk_test123');
        expect(result).toEqual(mockRotateSecretResponse);
      });
    });
  });

  describe('Inbox Webhooks', () => {
    describe('createInboxWebhook', () => {
      it('should create an inbox webhook', () => {
        const dto: CreateWebhookDto = {
          url: 'https://example.com/webhook',
          events: ['email.received'],
        };

        const result = controller.createInboxWebhook('test@inbox.com', dto);

        expect(webhookService.createInboxWebhook).toHaveBeenCalledWith('test@inbox.com', dto);
        expect(result).toEqual(mockWebhookResponse);
      });
    });

    describe('listInboxWebhooks', () => {
      it('should list all webhooks for an inbox', () => {
        const result = controller.listInboxWebhooks('test@inbox.com');

        expect(webhookService.listInboxWebhooks).toHaveBeenCalledWith('test@inbox.com');
        expect(result).toEqual(mockWebhookListResponse);
      });
    });

    describe('getInboxWebhook', () => {
      it('should return an inbox webhook by ID', () => {
        const result = controller.getInboxWebhook('test@inbox.com', 'whk_test123');

        expect(webhookService.getInboxWebhook).toHaveBeenCalledWith('test@inbox.com', 'whk_test123');
        expect(result).toEqual(mockWebhookResponse);
      });
    });

    describe('updateInboxWebhook', () => {
      it('should update an inbox webhook', () => {
        const dto: UpdateWebhookDto = { enabled: false };

        const result = controller.updateInboxWebhook('test@inbox.com', 'whk_test123', dto);

        expect(webhookService.updateInboxWebhook).toHaveBeenCalledWith('test@inbox.com', 'whk_test123', dto);
        expect(result).toEqual(mockWebhookResponse);
      });
    });

    describe('deleteInboxWebhook', () => {
      it('should delete an inbox webhook', () => {
        controller.deleteInboxWebhook('test@inbox.com', 'whk_test123');

        expect(webhookService.deleteInboxWebhook).toHaveBeenCalledWith('test@inbox.com', 'whk_test123');
      });
    });

    describe('testInboxWebhook', () => {
      it('should test an inbox webhook', async () => {
        const result = await controller.testInboxWebhook('test@inbox.com', 'whk_test123');

        expect(webhookService.testInboxWebhook).toHaveBeenCalledWith('test@inbox.com', 'whk_test123');
        expect(result).toEqual(mockTestResponse);
      });
    });

    describe('rotateInboxWebhookSecret', () => {
      it('should rotate the secret for an inbox webhook', () => {
        const result = controller.rotateInboxWebhookSecret('test@inbox.com', 'whk_test123');

        expect(webhookService.rotateInboxWebhookSecret).toHaveBeenCalledWith('test@inbox.com', 'whk_test123');
        expect(result).toEqual(mockRotateSecretResponse);
      });
    });
  });
});
