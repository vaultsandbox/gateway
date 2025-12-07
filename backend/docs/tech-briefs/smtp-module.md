# SMTP Module

Receive-only SMTP server for accepting and validating incoming emails.

## Architecture

```
                     ┌─────────────────────────────────────────────────────┐
                     │                    SmtpModule                       │
                     └─────────────────────────────────────────────────────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              │                             │                             │
              ▼                             ▼                             ▼
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│     SmtpService      │     │  SmtpHandlerService  │     │ SmtpRateLimiterSvc   │
│  (server lifecycle)  │────▶│  (protocol handlers) │     │   (per-IP limits)    │
└──────────────────────┘     └──────────────────────┘     └──────────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────────┐
              │                         │                             │
              ▼                         ▼                             ▼
┌──────────────────────┐  ┌──────────────────────┐     ┌──────────────────────┐
│EmailValidationService│  │EmailProcessingService│     │  EmailStorageService │
│  (SPF/DKIM/DMARC)    │  │   (parsing/headers)  │     │   (memory storage)   │
└──────────────────────┘  └──────────────────────┘     └──────────────────────┘
```

## Connection Flow

```
Client                              Server
  │                                   │
  │  1. TCP Connect                   │
  │  ──────────────────────────────▶  │  Rate limit check (per-IP)
  │                                   │  Early talker delay (300ms default)
  │                                   │
  │  2. MAIL FROM                     │
  │  ──────────────────────────────▶  │  Validate sender format
  │                                   │  SPF check (async, non-blocking)
  │                                   │  Reverse DNS check (async)
  │                                   │
  │  3. RCPT TO                       │
  │  ──────────────────────────────▶  │  Domain whitelist check
  │                                   │  Inbox existence check (local mode)
  │                                   │
  │  4. DATA                          │
  │  ──────────────────────────────▶  │  DKIM signature verification
  │                                   │  DMARC policy evaluation
  │                                   │  Encrypt + store (local mode)
  │                                   │
  │         250 OK                    │
  │  ◀──────────────────────────────  │
```

## Security Measures

| Layer | Control | Purpose |
|-------|---------|---------|
| Connection | Rate limiting | Per-IP request throttling |
| Connection | Early talker delay | Detect bots sending before banner |
| Connection | Max connections (25) | Prevent resource exhaustion |
| Protocol | Disabled commands | VRFY, EXPN, ETRN, TURN, AUTH blocked |
| Protocol | Header size limit (64KB) | Prevent parser DoS |
| Protocol | Message size limit | Configurable max (default 10MB) |
| Recipient | Domain whitelist | **Primary open-relay prevention** |
| Recipient | Inbox existence | Reject unknown recipients early |
| TLS | TLS 1.2+ required | Modern cipher suites only |

## Open Relay Prevention

The server prevents unauthorized relay through domain whitelisting:

```
VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS=example.com,test.example.com
```

Only emails to whitelisted domains are accepted. All others are rejected at RCPT TO with `550 This server does not accept mail for domain: <domain>`.

## Email Authentication (Non-Blocking)

Authentication checks run but don't reject mail. Results are logged and attached to stored emails.

| Check | What It Validates |
|-------|-------------------|
| SPF | Sender IP authorized for domain |
| DKIM | Email signature matches DNS public key |
| DMARC | SPF/DKIM alignment with From header |
| Reverse DNS | PTR record matches sending IP |

## Gateway Modes

**Local Mode** (default):
- Encrypts emails with recipient's ML-KEM-768 public key
- Stores in memory with automatic FIFO eviction
- Notifies clients via SSE events

**Backend Mode** (disabled):
- Forwards to backend HTTP API
- Currently throws error if enabled

## Key Files

| File | Responsibility |
|------|----------------|
| `smtp.service.ts` | Server lifecycle, TLS config, cert hot-reload |
| `smtp-handler.service.ts` | MAIL FROM/RCPT TO/DATA handlers |
| `email-validation.service.ts` | SPF, DKIM, DMARC, reverse DNS |
| `smtp-rate-limiter.service.ts` | Per-IP connection rate limiting |
| `email-processing.service.ts` | Email parsing (mailparser) |
| `storage/email-storage.service.ts` | In-memory storage with eviction |
