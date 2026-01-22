# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-01-22

### Added

- **Chaos Engineering**: Simulate email delivery failures to test application resilience against various failure scenarios.

[0.9.0]: https://github.com/vaultsandbox/gateway/releases/tag/v0.9.0

## [0.8.5] - 2026-01-19

### Added

- **Spam Analysis**: Rspamd integration for spam detection and analysis

[0.8.5]: https://github.com/vaultsandbox/gateway/releases/tag/v0.8.5

## [0.8.0] - 2026-01-16

### Added

- **Webhooks**: HTTP webhook notifications for email events (`email.received`, `email.stored`, `email.deleted`)
  - Global and inbox-scoped webhooks
  - HMAC-SHA256 request signatures for verification
  - Automatic retries with exponential backoff (up to 5 attempts)
  - Built-in templates for Slack, Discord, Teams, Zapier, and custom formats
  - Smart filtering by subject, sender, headers, and more with regex support

[0.8.0]: https://github.com/vaultsandbox/gateway/releases/tag/v0.8.0

## [0.7.1] - 2026-01-14

### Added

- **Screenshot Capture**: Take screenshots of emails in the web interface
- **Link Checking**: Check email links via proxy to bypass CORS restrictions
- **Proxy Module**: Backend proxy for image fetching and link validation
- **Zero-Config Local Development**: Run the gateway with no environment variables for local testing
  - Auto-detects dev mode when no domain is configured
  - Defaults to `localhost` domain, disabled email auth, and plain (unencrypted) inboxes
  - API key displayed in startup logs for easy access

### Changed

- Renamed `VSB_DEVELOPMENT` to `VSB_SDK_DEVELOPMENT` to avoid confusion with dev mode

[0.7.1]: https://github.com/vaultsandbox/gateway/releases/tag/v0.7.1

## [0.7.0] - 2026-01-12

### Added

- **Optional Encryption**: Inboxes can now be created without encryption for simplified testing workflows; encrypted inboxes remain the default (frontend + backend)
- **Optional Email Authentication**: Email authentication checks (SPF, DKIM, DMARC, ReverseDNS) are now individually configurable at the gateway level and can be disabled per inbox for simplified testing (frontend + backend)

### Changed

- **License**: Changed from AGPL-3.0/MIT dual-license to Apache-2.0
- SPF and reverse DNS checks moved to DATA phase to support per-inbox emailAuth configuration
- Added support for localhost, vaultsandbox, and private IPs (127.x, 10.x, 172.16-31.x, 192.168.x) in domain validation for local development

[0.7.0]: https://github.com/vaultsandbox/gateway/releases/tag/v0.7.0

## [0.6.1] - 2026-01-11

### Added

- **Clear All Inboxes**: New `VSB_LOCAL_ALLOW_CLEAR_ALL_INBOXES` env var to enable `DELETE /api/inboxes` endpoint; UI shows option only when enabled

### Changed

- Simplified email sync by computing hash on-demand instead of storing it

[0.6.1]: https://github.com/vaultsandbox/gateway/releases/tag/v0.6.1

## [0.6.0] - 2026-01-04

### Changed

- **Inbox Export Format v1**: Export format now conforms to VaultSandbox Cryptographic Protocol Specification v1.0
  - Added `version: 1` field for format versioning
  - Renamed `secretKeyB64` to `secretKey`
  - Switched to base64url encoding (RFC 4648 Section 5) for cryptographic keys
  - Added key size validation (ML-KEM-768: 2400 bytes, ML-DSA-65: 1952 bytes)
  - Export filenames now sanitize email addresses per spec (@ → _at_)
- Added `includeContent` query parameter to `GET /api/inboxes/:email/emails` to optionally return full email content, reducing N+1 API calls for SDK clients

### Updated

- mailparser: 3.9.0 → 3.9.1
- smtp-server: 3.16.1 → 3.17.1

[0.6.0]: https://github.com/vaultsandbox/gateway/releases/tag/v0.6.0

## [0.5.5] - 2025-12-31

### Added

- **Test Email API Endpoint**: New `POST /api/test/emails` endpoint for creating test emails with controlled authentication results (SPF, DKIM, DMARC, ReverseDNS). Enables SDK integration tests to verify auth result parsing without sending real emails. Only available when `VSB_DEVELOPMENT=true`.

[0.5.5]: https://github.com/vaultsandbox/gateway/releases/tag/v0.5.5

## [0.5.4] - 2025-12-28

### Added

- **TLS Info in Received Headers**: Received email headers now include TLS connection details (version, cipher, bits) for transport security transparency

[0.5.4]: https://github.com/vaultsandbox/gateway/releases/tag/v0.5.4

## [0.5.3] - 2025-12-21

### Security

- Hardened CSP by removing unsafe-inline from script-src
- Added post-collection size check for SMTP DATA to catch SIZE extension bypass

### Changed

- Added 15s timeout to VSX DNS check-in
- Renamed `vsb.main.backend` to `vsb.main.backend.url`
- Email viewer shows loading spinner during initial email load

### Fixed

- DMARC alignment check now uses truthy domain value
- Email display now uses From header instead of envelope sender

[0.5.3]: https://github.com/vaultsandbox/gateway/releases/tag/v0.5.3

## [0.5.2] - 2025-12-19

### Added

- **Docker Hardened Images**: Support for hardened container environments with restricted permissions

### Changed

- **VSX DNS HTTPS**: VSX DNS service now uses HTTPS endpoint for improved security

### Fixed

- Permission denied error in hardened Docker image environments
- URL extraction parenthesis over-stripping issue

### Security

- Removed unconditional trust proxy setting to prevent IP spoofing

[0.5.2]: https://github.com/vaultsandbox/gateway/releases/tag/v0.5.2

## [0.5.1] - 2025-12-14

### Added

- **VSX DNS Auto-Discovery**: Automatic domain discovery via vsx.email DNS service eliminates manual domain configuration
- **Certificate Domain Mismatch Detection**: Automatic certificate renewal when configured domains differ from current certificate

### Changed

- **Optional Certificate Email**: VSB_CERT_EMAIL is now optional; Let's Encrypt allows registration without email (users won't receive expiry notifications)
- **Production Logging**: Reduced log verbosity in production mode (debug/verbose logs disabled)
- **Default Inline Images**: Email viewer now displays inline images by default
- **Docker Compose**: Simplified default configuration to use VSX DNS auto-discovery

### Fixed

- Certificate service now detects and handles domain configuration changes

[0.5.1]: https://github.com/vaultsandbox/gateway/releases/tag/v0.5.1

## [0.5.0] - 2025-12-07

### Added

- **Core SMTP Server**: Secure, receive-only SMTP server with automatic TLS certificate management via Let's Encrypt ACME
- **Email Authentication**: Full SPF, DKIM, DMARC, and reverse DNS validation on every incoming message
- **Zero-Knowledge Storage**: Client-side key generation with server-side public-key encryption; plaintext never stored
- **Quantum-Safe Cryptography**: ML-KEM-768 key encapsulation and ML-DSA-65 digital signatures with AES-256-GCM encryption
- **Web Interface**: Angular-based UI for inbox management, HTML email preview, header inspection, and authentication results
- **Real-Time Delivery**: Server-Sent Events (SSE) for deterministic test automation without polling
- **Multi-Platform Docker**: Production-ready container with linux/amd64 and linux/arm64 support
- **CI/CD Workflows**: GitHub Actions for automated testing and Docker image publishing
- **Security Hardening**: Rate limiting, connection limits, early talker detection, and TLS 1.2+ enforcement

### Security

- Non-root container execution (uid 1001)
- API keys never logged to stdout/container logs
- Configurable disabled SMTP commands (VRFY, EXPN, ETRN, TURN, AUTH by default)

### Documentation

- Comprehensive README with quick start guide and architecture overview
- Contributing guidelines with PR process and code style requirements
- Security policy with vulnerability reporting process
- Code of Conduct (Contributor Covenant v2.1)
- Design philosophy documentation

[0.5.0]: https://github.com/vaultsandbox/gateway/releases/tag/v0.5.0
