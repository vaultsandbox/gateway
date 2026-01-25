<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/images/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="../docs/images/logo-light.svg">
  <img alt="Project Logo" src="../docs/images/logo-dark.svg">
</picture>

# Gateway - Backend

A secure, receive-only SMTP server built with NestJS for QA/testing environments. Accepts incoming emails, validates them (SPF, DKIM, DMARC, reverse DNS), and stores them with configurable retention. Includes automatic TLS certificate management via Let's Encrypt.

> For Docker deployment and production setup, see the [main README](../README.md).

## Features

- **Secure SMTP Server**: Receive-only email server with automatic TLS
- **Email Authentication**: SPF, DKIM, DMARC, and reverse DNS validation
- **Automatic TLS Certificates**: Let's Encrypt integration with ACME HTTP-01 challenge
- **Local Mode**: In-memory email storage with configurable TTL (defaults to 7 days)
- **Web Interface**: Angular frontend served at `/app` endpoint
- **Health Monitoring**: Built-in health checks and status endpoints
- **[Spam Analysis](https://vaultsandbox.dev/gateway/spam-analysis/)**: SpamAssassin-style scoring and detection
- **[Webhooks](https://vaultsandbox.dev/gateway/webhooks/)**: HTTP notifications for email events
- **[Chaos Engineering](https://vaultsandbox.dev/gateway/chaos-engineering/)**: Test email pipeline resilience

## Quick Start

### Prerequisites

- Node.js 18+

### Installation

```bash
cd gateway/backend
npm install
```

### Configuration

```bash
# Copy template and customize
cp template-env .env
```

See `template-env` for all available configuration options.

### Development

```bash
# Start backend in development mode (hot reload)
npm run start:dev

# Access the application
# - Web UI: http://localhost:80/app (or configured VSB_SERVER_PORT)
# - Health: http://localhost:80/health
# - API Docs: http://localhost:80/api-docs (dev mode only)
```

**Note:** For local development without Let's Encrypt, set `VSB_CERT_ENABLED=false` and use HTTP only.

### Getting Your API Key

On first startup, an API key is automatically generated and saved to `${VSB_DATA_PATH}/.api-key` (default: `/app/data/.api-key`).

**Security Note:** API keys are never logged to stdout/container logs to prevent exposure in centralized logging systems. To retrieve your API key:

```bash
# In Docker container (Works for both Compose and CLI)
docker exec -it vaultsandbox-gateway cat /app/data/.api-key
```

The startup logs will confirm the key was loaded:
```
[ConfigValidation] ✓ Local API key loaded from generated
```

**For production deployments:**
- Explicitly set `VSB_LOCAL_API_KEY` in your environment or `.env` file
- Use `VSB_LOCAL_API_KEY_STRICT=true` to require manual configuration and prevent auto-generation

Use this key in the `X-API-Key` header for API requests.

### Building

```bash
# Build backend only
npm run build

# Build frontend only
npm run build:frontend

# Build both frontend and backend
npm run build:all
```

### Production

```bash
# Run in production mode
npm run start:prod
```

## Available Scripts

- `npm run start:dev` - Start development server with hot reload
- `npm run build` - Build backend
- `npm run build:frontend` - Build Angular frontend
- `npm run build:all` - Build both frontend and backend
- `npm run start:prod` - Run in production mode
- `npm run test` - Run unit tests
- `npm run test:e2e` - Run end-to-end tests
- `npm run lint` - Lint code with ESLint
- `npm run format` - Format code with Prettier

## Configuration

The gateway is configured via environment variables. See `template-env` for all available options.

### Key Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `VSB_VSX_DNS_ENABLED` | Enable zero-config VSX DNS | `false` |
| `VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS` | Domains to accept emails for | - |
| `VSB_CERT_ENABLED` | Enable Let's Encrypt certificates | `false` |
| `VSB_LOCAL_INBOX_MAX_TTL` | Email retention period | `7d` |
| `VSB_SMTP_PORT` | SMTP server port | `25` |
| `VSB_SERVER_PORT` | HTTP server port | `80` |
| `VSB_SERVER_HTTPS_PORT` | HTTPS server port | `443` |
| `VSB_DATA_PATH` | Data storage path | `/app/data` |

### API Documentation

Available at `/api-docs` when running in development mode.

## Architecture

The gateway consists of several NestJS modules:

1. **SMTP Module**: Receive-only email server with SPF/DKIM/DMARC validation
2. **Inbox Module**: Local in-memory email storage with TTL (default mode)
3. **Certificate Module**: Automatic Let's Encrypt TLS certificate management
4. **Crypto Module**: Quantum-safe encryption (ML-KEM-768, ML-DSA-65) for backend mode
5. **Health Module**: Health checks and monitoring endpoints
6. **Orchestration Module**: Optional distributed coordination for multi-node clusters
7. **Frontend Integration**: Angular SPA served at `/app` endpoint

### Gateway Modes

- **Local Mode** (default): Stores emails in-memory with configurable TTL (7 days default). Perfect for QA/testing. Supports both encrypted and plain inboxes, with optional email authentication per inbox.
- **Backend Mode**: Encrypts emails and forwards to backend service for compliance/retention.(🚧 In Progress)

### Security Features

- Domain-based recipient filtering (prevents open relay)
- Automatic API key generation and persistence
- TLS encryption with automatic certificate renewal
- Rate limiting (500 req/min API, 500 emails/sec SMTP)
- SMTP hardening (disabled VRFY/EXPN, connection limits)
- Quantum-safe encryption

For architectural details and implementation guides, visit [vaultsandbox.dev](https://vaultsandbox.dev).

## Development Workflow

### Full Stack Development

```bash
# Terminal 1: Backend with hot reload
cd backend
npm run start:dev

# Terminal 2: Frontend with hot reload
cd frontend
npm start
```

Access:
- Frontend: http://localhost:4200 (with hot reload)
- Backend: http://localhost:80 (or configured port)

## Support & Contributing

- **Documentation**: [vaultsandbox.dev/gateway](https://vaultsandbox.dev/gateway/)
- **Issues**: [github.com/vaultsandbox/gateway/issues](https://github.com/vaultsandbox/gateway/issues)
- **Discussions**: [github.com/vaultsandbox/gateway/discussions](https://github.com/vaultsandbox/gateway/discussions)
- **Website**: [vaultsandbox.com](https://www.vaultsandbox.com)

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](./LICENSE) file for details.
