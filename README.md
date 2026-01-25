<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/images/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./docs/images/logo-light.svg">
  <img alt="Project Logo" src="./docs/images/logo-dark.svg">
</picture>

> **VaultSandbox is in Public Beta.** Join the journey to 1.0. Share feedback on [GitHub](https://github.com/vaultsandbox/gateway/discussions).

# Gateway

**[VaultSandbox](https://vaultsandbox.com)** is a self-hosted SMTP testing gateway designed to replicate production email behavior—including TLS, DNS, authentication, and spam scoring—so your email tests reflect real-world conditions.

This repository contains the Gateway: the core backend service and web interface for receiving, validating, and inspecting test emails.

### 🎯 Key Features

- **Zero-Config Setup**: 1 env var (VSX DNS) or 2 env vars (custom domain)
- **Production-Ready SMTP**: Receive-only server on port 25 with automatic TLS
- **Email Authentication**: Full SPF, DKIM, DMARC, and reverse DNS validation
- **Automatic Certificates**: Let's Encrypt integration with hot-reload
- **Web Interface**: Modern Angular UI at `/app` endpoint
- **Configurable Retention**: Defaults to 7 days (easily adjusted)
- **Multi-Node Support**: Optional distributed coordination for clusters
- **Encryption**: Secure in-memory storage
- **[Spam Analysis](https://vaultsandbox.dev/gateway/spam-analysis/)**: SpamAssassin-style scoring and detection
- **[Webhooks](https://vaultsandbox.dev/gateway/webhooks/)**: HTTP notifications for email events
- **[Chaos Engineering](https://vaultsandbox.dev/gateway/chaos-engineering/)**: Test email pipeline resilience

### 📦 Monorepo Components

This repository is a monorepo containing two main components:

*   **[`/backend`](./backend/)**: A [NestJS](https://nestjs.com/)-based backend application providing:
    - Receive-only SMTP server with SPF/DKIM/DMARC validation
    - REST API for email access with auto-generated API keys
    - Automatic Let's Encrypt TLS certificate management
    - Optional quantum-safe encryption for backend forwarding
    - Health monitoring and metrics endpoints

    👉 **[Read the Backend Documentation](./backend/README.md)**

*   **[`/frontend`](./frontend/)**: An [Angular](https://angular.io/)-based single-page application providing:
    - Email management
    - Visual display of authentication results (SPF, DKIM, DMARC)
    - Custom inbox management
    - Real-time updates via Server-Sent Events
    - Dark/light theme with automatic switching
    - Quantum-safe payload decryption

    👉 **[Read the Frontend Documentation](./frontend/README.md)**

## Quick Start

### Option 1: VSX DNS (Recommended)

**Zero-config setup with automatic DNS.** No domain registration, no DNS configuration, no waiting for propagation. Your public IP is encoded into a subdomain (e.g., `1mzhr2y.vsx.email`) that automatically resolves with proper MX records.

**Requirement:** Ports 25, 80, and 443 must be publicly reachable.

```yaml
# docker-compose.yml
services:
  gateway:
    image: vaultsandbox/gateway:latest
    ports:
      - "25:25"   # SMTP
      - "80:80"   # HTTP (ACME + VSX verification)
      - "443:443" # HTTPS
    environment:
      - VSB_VSX_DNS_ENABLED=true
    volumes:
      - gateway-data:/app/data

volumes:
  gateway-data:
```

```bash
# Start the gateway
docker compose up -d

# Find your assigned domain
docker compose exec gateway cat /app/data/certificates/metadata.json; echo

# Retrieve auto-generated API key
docker compose exec gateway cat /app/data/.api-key; echo
```

You can also find your domain by entering your IP at [vsx.email](https://vsx.email).

**Total setup time: ~5 minutes**

### Option 2: Custom Domain

**Use your own domain** for branding, compliance, or existing infrastructure. Requires DNS configuration pointing to your server.

**DNS Requirements:** Before starting, configure these records:
- **A record:** `qa.example.com` → your server IP
- **MX record:** `qa.example.com` → `qa.example.com` (priority 10)

```yaml
# docker-compose.yml
services:
  gateway:
    image: vaultsandbox/gateway:latest
    ports:
      - "25:25"   # SMTP
      - "80:80"   # HTTP (ACME challenge)
      - "443:443" # HTTPS
    environment:
      - VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS=qa.example.com
      - VSB_CERT_ENABLED=true
    volumes:
      - gateway-data:/app/data

volumes:
  gateway-data:
```

```bash
# Start the gateway
docker compose up -d

# Retrieve auto-generated API key
docker compose exec gateway cat /app/data/.api-key; echo
```

### What You Get (Public Deployment)

After starting the gateway, you have:

✅ SMTP server accepting emails on port 25
✅ Automatic TLS certificates from Let's Encrypt
✅ Web UI at `https://your-domain/app`
✅ REST API with auto-generated API key
✅ 7-day email retention (configurable)
✅ Full email authentication validation (SPF, DKIM, DMARC)

### Option 3: Local Development

```yaml
# docker-compose.yml
services:
  vaultsandbox:
    image: vaultsandbox/gateway:latest
    ports:
      - '127.0.0.1:2525:25'
      - '127.0.0.1:8080:80'
    volumes:
      - vsb_data:/app/data

volumes:
  vsb_data:
```

```bash
docker compose up -d

# Retrieve auto-generated API key
docker compose exec vaultsandbox cat /app/data/.api-key; echo
```

### What You Get (Local)

✅ SMTP server on `localhost:2525` (no TLS)
✅ Web UI at `http://localhost:8080/app`
✅ REST API at `http://localhost:8080/api`
✅ 7-day email retention (configurable)

### Development Environment Setup

```bash
# Clone the repository
git clone https://github.com/vaultsandbox/gateway.git
cd gateway

# Backend development
cd backend
npm install
cp template-env .env  # Configure your environment
npm run start:dev

# Frontend development (separate terminal)
cd frontend
npm install
npm start  # Runs on http://localhost:4200
```

## Architecture

The gateway consists of two tightly integrated components:

### Backend (NestJS)
- **SMTP Module**: Handles email reception and validation
- **Certificate Module**: Automatic Let's Encrypt certificate management
- **Inbox Module**: Local email storage with TTL
- **Crypto Module**: Quantum-safe encryption for backend mode
- **API**: RESTful endpoints for email access
- **Static Serving**: Serves the Angular frontend at `/app`

### Frontend (Angular)
- **Email Management**: Browse received emails
- **Authentication Display**: Visual SPF/DKIM/DMARC results
- **Custom Inboxes**: Organize emails into virtual inboxes
- **Real-Time Updates**: SSE for instant notifications
- **Metrics Dashboard**: Monitor gateway health and performance

### Integration Points

```
┌────────────────────────────────────────┐
│  Frontend (Angular)                    │
│  - Served at /app                      │
│  - API calls via /api                  │
│  - SSE at /api/inbox/sse               │
└──────────────┬─────────────────────────┘
               │
               │ HTTP(S)
               │
┌──────────────▼─────────────────────────┐
│  Backend (NestJS)                      │
│  ┌─────────────────────────────────┐   │
│  │ Static Files (@nestjs/serve)    │   │
│  │ /app → frontend/dist/browser    │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ REST API                        │   │
│  │ /api/inbox, /api/emails, etc    │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ SMTP Server (port 25)           │   │
│  │ SPF/DKIM/DMARC validation       │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ Certificate Management          │   │
│  │ Let's Encrypt ACME              │   │
│  └─────────────────────────────────┘   │
└────────────────────────────────────────┘
```

## Development

### Backend Development
```bash
cd backend
npm run start:dev        # Hot reload
npm run build:all        # Build backend + frontend
npm run test             # Unit tests
npm run lint             # ESLint
```

**[Full Backend Documentation →](./backend/README.md)**

### Frontend Development
```bash
cd frontend
npm start                # Dev server (port 4200)
npm run build           # Production build
npm test                # Unit tests
npm run lint            # ESLint
```

**[Full Frontend Documentation →](./frontend/README.md)**

## Documentation

- **[Backend README](./backend/README.md)**: Complete backend documentation
  - Configuration options
  - SMTP server setup
  - Certificate management
  - Clustering and orchestration
  - API endpoints

- **[Frontend README](./frontend/README.md)**: Complete frontend documentation
  - Component architecture
  - State management
  - Email authentication display
  - Quantum-safe encryption
  - Styling and theming

- **[Contributing Guide](./CONTRIBUTING.md)**: Development setup and contribution guidelines
- **[Code of Conduct](./CODE_OF_CONDUCT.md)**: Community guidelines
- **[Security Policy](./SECURITY.md)**: Vulnerability reporting and security practices
- **[Changelog](./CHANGELOG.md)**: Version history and release notes
- **[Design Philosophy](./docs/PHILOSOPHY.md)**: Our open source philosophy and architecture decisions

## License

This project is licensed under the [Apache License 2.0](./LICENSE.md).

## Code of Conduct

All contributors are expected to adhere to our [Code of Conduct](./CODE_OF_CONDUCT.md). Please ensure you are familiar with its contents.

## Support

- [Documentation](https://vaultsandbox.dev/gateway/)
- [Issue Tracker](https://github.com/vaultsandbox/gateway/issues)
- [Discussions](https://github.com/vaultsandbox/gateway/discussions)
- [Website](https://www.vaultsandbox.com)