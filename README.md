<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/images/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./docs/images/logo-light.svg">
  <img alt="Project Logo" src="./docs/images/logo-dark.svg">
</picture>

# Gateway

Welcome to the VaultSandbox Gateway project! This is the central repository for the gateway, which is composed of a backend service and a frontend web application.

## Project Overview

VaultSandbox Gateway is a **secure, receive-only SMTP server** designed for QA/testing environments. It accepts incoming emails, validates them (SPF, DKIM, DMARC, reverse DNS), and stores them with configurable retention. The gateway includes automatic TLS certificate management via Let's Encrypt and a modern web interface for email inspection.

### 🎯 Key Features

- **Zero-Config Setup**: Just 3 environment variables to get started
- **Production-Ready SMTP**: Receive-only server on port 25 with automatic TLS
- **Email Authentication**: Full SPF, DKIM, DMARC, and reverse DNS validation
- **Automatic Certificates**: Let's Encrypt integration with hot-reload
- **Web Interface**: Modern Angular UI at `/app` endpoint
- **Configurable Retention**: Defaults to 7 days (easily adjusted)
- **Multi-Node Support**: Optional distributed coordination for clusters
- **Quantum-Safe Crypto**: ML-KEM-768 and ML-DSA-65 for backend mode

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

### Using Docker (Recommended)

The fastest way to get started is using the included `docker-compose.yml` or the Docker CLI with a named volume.

**Option 1: Docker Compose (Preferred)**

```bash
# Start the gateway
docker compose up -d

# Retrieve auto-generated API key
docker compose exec gateway cat /app/data/.api-key
```

**Option 2: Docker CLI**

```bash
# Create a volume for data persistence
docker volume create gateway-data

# Run the container
docker run -d \
  --name vaultsandbox-gateway \
  -p 25:25 -p 80:80 -p 443:443 \
  -e VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS="qa.example.com" \
  -e VSB_CERT_ENABLED="true" \
  -e VSB_CERT_EMAIL="admin@example.com" \
  -v gateway-data:/app/data \
  vaultsandbox/gateway:latest

# Access the web interface
# https://qa.example.com/app
```

**Total setup time: ~5 minutes** ⚡

### Local Development

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

### What You Get

After starting the gateway, you have:

✅ SMTP server accepting emails at `qa.example.com:25`
✅ Automatic TLS certificates from Let's Encrypt
✅ Web UI at `https://qa.example.com/app`
✅ REST API with auto-generated API key
✅ 7-day email retention (configurable)
✅ Full email authentication validation

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

## Licensing

This project uses a dual-licensing model. Please be aware of the licenses for each component:

*   **Backend**: Licensed under the [AGPL-3.0-or-later](./backend/LICENSE). See the [NOTICE](./backend/NOTICE) for copyright information.
*   **Frontend**: Licensed under the [MIT License](./frontend/LICENSE).

For a summary of the project's licensing, please see the [LICENSE.md](./LICENSE.md) file.

## Code of Conduct

All contributors are expected to adhere to our [Code of Conduct](./CODE_OF_CONDUCT.md). Please ensure you are familiar with its contents.
