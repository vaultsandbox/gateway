import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PeerAuthGuard } from '../guards/peer-auth.guard';
import { createHmac } from 'crypto';

describe('PeerAuthGuard', () => {
  let guard: PeerAuthGuard;

  const mockSharedSecret = 'test-shared-secret';
  const mockPeerToken = 'test-peer-token';
  const mockTimestamp = Date.now().toString();

  // Helper function to generate a valid signature
  const generateValidSignature = (token: string, timestamp: string, secret: string): string => {
    return createHmac('sha256', secret).update(`${token}:${timestamp}`).digest('hex');
  };

  // Helper function to create a mock execution context
  const createMockContext = (headers: Record<string, string | string[] | undefined>) => {
    const mockRequest = {
      headers,
    };

    const mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as unknown as ExecutionContext;

    return mockContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeerAuthGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'vsb.certificate.peerSharedSecret') {
                return mockSharedSecret;
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    guard = module.get<PeerAuthGuard>(PeerAuthGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should throw UnauthorizedException when shared secret is not configured', () => {
      // Create a new guard instance with empty shared secret
      const mockConfigServiceEmpty = {
        get: jest.fn().mockReturnValue(''),
      };
      const guardEmptySecret = new PeerAuthGuard(mockConfigServiceEmpty as any);

      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': mockTimestamp,
        'x-peer-signature': generateValidSignature(mockPeerToken, mockTimestamp, mockSharedSecret),
      });

      expect(() => guardEmptySecret.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guardEmptySecret.canActivate(context)).toThrow('Peer authentication not configured');
    });

    it('should throw UnauthorizedException when shared secret is undefined', () => {
      // Create a new guard instance with undefined shared secret
      const mockConfigServiceUndefined = {
        get: jest.fn().mockReturnValue(undefined),
      };
      const guardUndefinedSecret = new PeerAuthGuard(mockConfigServiceUndefined as any);

      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': mockTimestamp,
        'x-peer-signature': generateValidSignature(mockPeerToken, mockTimestamp, mockSharedSecret),
      });

      expect(() => guardUndefinedSecret.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guardUndefinedSecret.canActivate(context)).toThrow('Peer authentication not configured');
    });

    it('should throw UnauthorizedException when x-peer-token header is missing', () => {
      const context = createMockContext({
        'x-peer-timestamp': mockTimestamp,
        'x-peer-signature': generateValidSignature(mockPeerToken, mockTimestamp, mockSharedSecret),
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Missing peer authentication');
    });

    it('should throw UnauthorizedException when x-peer-timestamp header is missing', () => {
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-signature': generateValidSignature(mockPeerToken, mockTimestamp, mockSharedSecret),
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Missing peer authentication');
    });

    it('should throw UnauthorizedException when x-peer-signature header is missing', () => {
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': mockTimestamp,
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Missing peer authentication');
    });

    it('should throw UnauthorizedException when timestamp is not a valid number', () => {
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': 'invalid-timestamp',
        'x-peer-signature': generateValidSignature(mockPeerToken, 'invalid-timestamp', mockSharedSecret),
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid timestamp');
    });

    it('should throw UnauthorizedException when timestamp is too old (more than 60 seconds)', () => {
      const oldTimestamp = (Date.now() - 120_000).toString(); // 2 minutes ago
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': oldTimestamp,
        'x-peer-signature': generateValidSignature(mockPeerToken, oldTimestamp, mockSharedSecret),
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid timestamp');
    });

    it('should throw UnauthorizedException when timestamp is too far in the future (more than 60 seconds)', () => {
      const futureTimestamp = (Date.now() + 120_000).toString(); // 2 minutes in the future
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': futureTimestamp,
        'x-peer-signature': generateValidSignature(mockPeerToken, futureTimestamp, mockSharedSecret),
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid timestamp');
    });

    it('should throw UnauthorizedException when signature length mismatch', () => {
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': mockTimestamp,
        'x-peer-signature': 'invalid-short-signature',
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid signature');
    });

    it('should throw UnauthorizedException when signature is invalid', () => {
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': mockTimestamp,
        'x-peer-signature': 'invalid-signature-with-same-length-as-real-one-but-wrong',
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid signature');
    });

    it('should throw UnauthorizedException when signature is not valid hex', () => {
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': mockTimestamp,
        'x-peer-signature': 'not-hex-signature-!@#$%',
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid signature');
    });

    it('should return true when all headers are valid and signature matches', () => {
      const validSignature = generateValidSignature(mockPeerToken, mockTimestamp, mockSharedSecret);
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': mockTimestamp,
        'x-peer-signature': validSignature,
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should handle headers as arrays and use the first value', () => {
      const validSignature = generateValidSignature(mockPeerToken, mockTimestamp, mockSharedSecret);
      const context = createMockContext({
        'x-peer-token': [mockPeerToken, 'another-token'],
        'x-peer-timestamp': [mockTimestamp, 'another-timestamp'],
        'x-peer-signature': [validSignature, 'another-signature'],
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should handle empty arrays in headers', () => {
      const context = createMockContext({
        'x-peer-token': [],
        'x-peer-timestamp': mockTimestamp,
        'x-peer-signature': generateValidSignature(mockPeerToken, mockTimestamp, mockSharedSecret),
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Missing peer authentication');
    });

    it('should work with timestamps at the edge of the tolerance window (59 seconds)', () => {
      const edgeTimestamp = (Date.now() - 59_000).toString(); // 59 seconds ago
      const validSignature = generateValidSignature(mockPeerToken, edgeTimestamp, mockSharedSecret);
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': edgeTimestamp,
        'x-peer-signature': validSignature,
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should work with future timestamps at the edge of the tolerance window (59 seconds)', () => {
      const edgeTimestamp = (Date.now() + 59_000).toString(); // 59 seconds in the future
      const validSignature = generateValidSignature(mockPeerToken, edgeTimestamp, mockSharedSecret);
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': edgeTimestamp,
        'x-peer-signature': validSignature,
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should work with future timestamps at the edge of the tolerance window (60 seconds)', () => {
      const edgeTimestamp = (Date.now() + 60_000).toString(); // Exactly 60 seconds in the future
      const validSignature = generateValidSignature(mockPeerToken, edgeTimestamp, mockSharedSecret);
      const context = createMockContext({
        'x-peer-token': mockPeerToken,
        'x-peer-timestamp': edgeTimestamp,
        'x-peer-signature': validSignature,
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('getHeaderValue', () => {
    it('should return the first element when value is an array', () => {
      const result = (guard as any).getHeaderValue(['first', 'second', 'third']);
      expect(result).toBe('first');
    });

    it('should return the value when it is a string', () => {
      const result = (guard as any).getHeaderValue('string-value');
      expect(result).toBe('string-value');
    });

    it('should return undefined when value is undefined', () => {
      const result = (guard as any).getHeaderValue(undefined);
      expect(result).toBeUndefined();
    });

    it('should return undefined when value is an empty array', () => {
      const result = (guard as any).getHeaderValue([]);
      expect(result).toBeUndefined();
    });
  });

  describe('generateSignature', () => {
    it('should generate a valid HMAC signature', () => {
      const token = 'test-token';
      const timestamp = '1234567890';
      const expectedSignature = createHmac('sha256', mockSharedSecret).update(`${token}:${timestamp}`).digest('hex');

      const result = (guard as any).generateSignature(token, timestamp);
      expect(result).toBe(expectedSignature);
    });

    it('should generate different signatures for different inputs', () => {
      const token1 = 'token1';
      const token2 = 'token2';
      const timestamp = '1234567890';

      const signature1 = (guard as any).generateSignature(token1, timestamp);
      const signature2 = (guard as any).generateSignature(token2, timestamp);

      expect(signature1).not.toBe(signature2);
    });

    it('should generate different signatures for different timestamps', () => {
      const token = 'test-token';
      const timestamp1 = '1234567890';
      const timestamp2 = '1234567891';

      const signature1 = (guard as any).generateSignature(token, timestamp1);
      const signature2 = (guard as any).generateSignature(token, timestamp2);

      expect(signature1).not.toBe(signature2);
    });
  });
});
