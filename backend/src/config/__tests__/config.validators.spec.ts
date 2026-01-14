import { isValidDomain, isPrivateIP } from '../config.validators';

describe('isPrivateIP', () => {
  it('should return true for loopback addresses (127.x.x.x)', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.0.0.2')).toBe(true);
    expect(isPrivateIP('127.255.255.255')).toBe(true);
  });

  it('should return true for Class A private addresses (10.x.x.x)', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('10.255.255.255')).toBe(true);
    expect(isPrivateIP('10.10.10.10')).toBe(true);
  });

  it('should return true for Class B private addresses (172.16-31.x.x)', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('172.20.10.5')).toBe(true);
  });

  it('should return false for non-private 172.x.x.x addresses', () => {
    expect(isPrivateIP('172.15.0.1')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
  });

  it('should return true for Class C private addresses (192.168.x.x)', () => {
    expect(isPrivateIP('192.168.0.1')).toBe(true);
    expect(isPrivateIP('192.168.1.23')).toBe(true);
    expect(isPrivateIP('192.168.255.255')).toBe(true);
  });

  it('should return false for public IP addresses', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('192.169.0.1')).toBe(false);
    expect(isPrivateIP('11.0.0.1')).toBe(false);
  });

  it('should return false for invalid IP formats', () => {
    expect(isPrivateIP('192.168.1')).toBe(false);
    expect(isPrivateIP('192.168.1.1.1')).toBe(false);
    expect(isPrivateIP('not.an.ip.address')).toBe(false);
    expect(isPrivateIP('')).toBe(false);
  });

  it('should return false for octets greater than 255', () => {
    expect(isPrivateIP('192.168.1.256')).toBe(false);
    expect(isPrivateIP('192.168.256.1')).toBe(false);
    expect(isPrivateIP('10.0.0.300')).toBe(false);
  });
});

describe('isValidDomain', () => {
  it('should return true for localhost', () => {
    expect(isValidDomain('localhost')).toBe(true);
  });

  it('should return true for vaultsandbox', () => {
    expect(isValidDomain('vaultsandbox')).toBe(true);
  });

  it('should return true for private IP addresses', () => {
    expect(isValidDomain('127.0.0.1')).toBe(true);
    expect(isValidDomain('10.0.0.1')).toBe(true);
    expect(isValidDomain('172.16.0.1')).toBe(true);
    expect(isValidDomain('192.168.1.23')).toBe(true);
  });

  it('should return false for public IP addresses', () => {
    expect(isValidDomain('8.8.8.8')).toBe(false);
    expect(isValidDomain('1.1.1.1')).toBe(false);
  });

  it('should return true for standard domains', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('google.com')).toBe(true);
    expect(isValidDomain('test.org')).toBe(true);
  });

  it('should return true for subdomains', () => {
    expect(isValidDomain('api.example.com')).toBe(true);
    expect(isValidDomain('mail.example.com')).toBe(true);
    expect(isValidDomain('sub.domain.example.org')).toBe(true);
  });

  it('should return false for invalid strings without TLD', () => {
    expect(isValidDomain('invalid')).toBe(false);
    expect(isValidDomain('notadomain')).toBe(false);
  });

  it('should return false for domains with too short TLD', () => {
    expect(isValidDomain('domain.c')).toBe(false);
    expect(isValidDomain('example.a')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isValidDomain('')).toBe(false);
  });

  it('should return false for domains with invalid characters', () => {
    expect(isValidDomain('exam_ple.com')).toBe(false);
    expect(isValidDomain('example .com')).toBe(false);
  });
});
