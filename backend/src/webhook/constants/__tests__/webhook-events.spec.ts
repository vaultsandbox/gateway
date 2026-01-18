import {
  WEBHOOK_EVENTS,
  WebhookEventType,
  ALL_WEBHOOK_EVENTS,
  isValidWebhookEvent,
  EMAIL_EVENTS,
  isEmailEvent,
} from '../webhook-events';

describe('webhook-events constants', () => {
  describe('WEBHOOK_EVENTS', () => {
    it('should define EMAIL_RECEIVED event', () => {
      expect(WEBHOOK_EVENTS.EMAIL_RECEIVED).toBe('email.received');
    });

    it('should define EMAIL_STORED event', () => {
      expect(WEBHOOK_EVENTS.EMAIL_STORED).toBe('email.stored');
    });

    it('should define EMAIL_DELETED event', () => {
      expect(WEBHOOK_EVENTS.EMAIL_DELETED).toBe('email.deleted');
    });

    it('should have exactly 3 events', () => {
      expect(Object.keys(WEBHOOK_EVENTS)).toHaveLength(3);
    });
  });

  describe('ALL_WEBHOOK_EVENTS', () => {
    it('should contain all webhook event values', () => {
      expect(ALL_WEBHOOK_EVENTS).toContain('email.received');
      expect(ALL_WEBHOOK_EVENTS).toContain('email.stored');
      expect(ALL_WEBHOOK_EVENTS).toContain('email.deleted');
    });

    it('should have the same length as WEBHOOK_EVENTS keys', () => {
      expect(ALL_WEBHOOK_EVENTS).toHaveLength(Object.keys(WEBHOOK_EVENTS).length);
    });

    it('should be an array', () => {
      expect(Array.isArray(ALL_WEBHOOK_EVENTS)).toBe(true);
    });
  });

  describe('isValidWebhookEvent', () => {
    it('should return true for valid email.received event', () => {
      expect(isValidWebhookEvent('email.received')).toBe(true);
    });

    it('should return true for valid email.stored event', () => {
      expect(isValidWebhookEvent('email.stored')).toBe(true);
    });

    it('should return true for valid email.deleted event', () => {
      expect(isValidWebhookEvent('email.deleted')).toBe(true);
    });

    it('should return false for invalid event type', () => {
      expect(isValidWebhookEvent('invalid.event')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidWebhookEvent('')).toBe(false);
    });

    it('should return false for partial match', () => {
      expect(isValidWebhookEvent('email')).toBe(false);
      expect(isValidWebhookEvent('received')).toBe(false);
    });

    it('should return false for case variations', () => {
      expect(isValidWebhookEvent('EMAIL.RECEIVED')).toBe(false);
      expect(isValidWebhookEvent('Email.Received')).toBe(false);
    });

    it('should act as type guard', () => {
      const event: string = 'email.received';
      if (isValidWebhookEvent(event)) {
        // TypeScript should recognize event as WebhookEventType here
        const typedEvent: WebhookEventType = event;
        expect(typedEvent).toBe('email.received');
      }
    });
  });

  describe('EMAIL_EVENTS', () => {
    it('should contain email.received', () => {
      expect(EMAIL_EVENTS).toContain(WEBHOOK_EVENTS.EMAIL_RECEIVED);
    });

    it('should contain email.stored', () => {
      expect(EMAIL_EVENTS).toContain(WEBHOOK_EVENTS.EMAIL_STORED);
    });

    it('should contain email.deleted', () => {
      expect(EMAIL_EVENTS).toContain(WEBHOOK_EVENTS.EMAIL_DELETED);
    });

    it('should have exactly 3 email events', () => {
      expect(EMAIL_EVENTS).toHaveLength(3);
    });

    it('should be an array of WebhookEventType', () => {
      EMAIL_EVENTS.forEach((event) => {
        expect(isValidWebhookEvent(event)).toBe(true);
      });
    });
  });

  describe('isEmailEvent', () => {
    it('should return true for email.received', () => {
      expect(isEmailEvent(WEBHOOK_EVENTS.EMAIL_RECEIVED)).toBe(true);
    });

    it('should return true for email.stored', () => {
      expect(isEmailEvent(WEBHOOK_EVENTS.EMAIL_STORED)).toBe(true);
    });

    it('should return true for email.deleted', () => {
      expect(isEmailEvent(WEBHOOK_EVENTS.EMAIL_DELETED)).toBe(true);
    });

    it('should return true for all events in EMAIL_EVENTS', () => {
      EMAIL_EVENTS.forEach((event) => {
        expect(isEmailEvent(event)).toBe(true);
      });
    });

    it('should return true for all currently defined events', () => {
      // Currently all events are email-related
      ALL_WEBHOOK_EVENTS.forEach((event) => {
        expect(isEmailEvent(event)).toBe(true);
      });
    });
  });

  describe('type consistency', () => {
    it('should have EMAIL_EVENTS as subset of ALL_WEBHOOK_EVENTS', () => {
      EMAIL_EVENTS.forEach((event) => {
        expect(ALL_WEBHOOK_EVENTS).toContain(event);
      });
    });

    it('should have all WEBHOOK_EVENTS values in ALL_WEBHOOK_EVENTS', () => {
      Object.values(WEBHOOK_EVENTS).forEach((event) => {
        expect(ALL_WEBHOOK_EVENTS).toContain(event);
      });
    });
  });
});
