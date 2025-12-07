# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
