# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
