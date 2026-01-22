<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/images/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="../docs/images/logo-light.svg">
  <img alt="Project Logo" src="../docs/images/logo-dark.svg">
</picture>

# Gateway - Backend

A secure, receive-only SMTP server built with NestJS for QA/testing environments. Accepts incoming emails, validates them (SPF, DKIM, DMARC, reverse DNS), and stores them with configurable retention. Includes automatic TLS certificate management via Let's Encrypt and an Angular web interface.

## 🚀 What You Get

Set **just 1 environment variable** (VSX DNS) or **2 variables** (custom domain) and get:

- ✅ Production-ready SMTP server on port 25
- ✅ Automatic Let's Encrypt TLS certificates
- ✅ Web UI for viewing emails at `https://your-domain/app`
- ✅ REST API with auto-generated API key
- ✅ Configurable email retention (defaults to 7 days, easily adjusted)
- ✅ Full email authentication (SPF, DKIM, DMARC)

**Total setup time: ~5 minutes**

## Features

- **Zero-Config Setup**: 1 env var (VSX DNS) or 2 env vars (custom domain)
- **Secure SMTP Server**: Receive-only email server with automatic TLS
- **Email Authentication**: SPF, DKIM, DMARC, and reverse DNS validation
- **Automatic TLS Certificates**: Let's Encrypt integration with ACME HTTP-01 challenge
- **Local Mode**: In-memory email storage with configurable TTL (defaults to 7 days)
- **Web Interface**: Angular frontend served at `/app` endpoint
- **Health Monitoring**: Built-in health checks and status endpoints
- **[Spam Analysis](https://vaultsandbox.dev/gateway/spam-analysis/)**: SpamAssassin-style scoring and detection
- **[Webhooks](https://vaultsandbox.dev/gateway/webhooks/)**: HTTP notifications for email events
- **[Chaos Engineering](https://vaultsandbox.dev/gateway/chaos-engineering/)**: Test email pipeline resilience

## Monorepo Structure

```
vaultsandbox-gateway/
├── backend/           # NestJS backend (this directory)
│   ├── src/          # Source code
│   ├── test/         # Tests
│   └── dist/         # Compiled output
└── frontend/          # Angular web application
    ├── src/          # Source code
    └── dist/         # Build output (served by backend)
```

## Quick Start

### Prerequisites

- Node.js 18+ (for local development)
- Docker (recommended for production)

### Installation

```bash
# Clone the repository
git clone https://github.com/vaultsandbox/gateway.git
cd gateway/backend

# Install dependencies
npm install
```

### Configuration

Create a `.env` file with minimal configuration:

```bash
# Copy template and customize
cp template-env .env

# Option 1: VSX DNS (simplest - just 1 variable)
VSB_VSX_DNS_ENABLED=true

# Option 2: Custom domain (2 variables)
# VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS=qa.example.com
# VSB_CERT_ENABLED=true
```

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

The gateway is configured via environment variables with sensible defaults for testing environments.

### Option 1: VSX DNS (Recommended)

**Zero-config setup with automatic DNS.** No domain registration, no DNS configuration, no waiting for propagation. Your public IP is encoded into a subdomain (e.g., `1mzhr2y.vsx.email`) that automatically resolves with proper MX records.

Just **1 environment variable**:

```bash
VSB_VSX_DNS_ENABLED=true
```

Find your assigned domain by entering your IP at [vsx.email](https://vsx.email) or:

```bash
cat /app/data/certificates/metadata.json
```

### Option 2: Custom Domain

**Use your own domain** for branding, compliance, or existing infrastructure.

Just **2 environment variables**:

```bash
# Domains to accept emails for (comma-separated)
VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS=qa.example.com,test.example.com

# Enable automatic Let's Encrypt certificates
VSB_CERT_ENABLED=true
```

**DNS Requirements:** Configure these records before starting:
- **A record:** `qa.example.com` → your server IP
- **MX record:** `qa.example.com` → `qa.example.com` (priority 10)

### Smart Defaults

Everything else has sensible defaults:
- ✅ Auto-generated API key (persisted to disk)
- ✅ Certificate domain auto-derived from first SMTP domain
- ✅ Email retention: 7 days (configurable via `VSB_LOCAL_INBOX_MAX_TTL`)
- ✅ CORS enabled for all origins (testing-friendly)
- ✅ Rate limiting and security controls enabled
- ✅ Standard ports (25, 80, 443)

### Optional Configuration

For advanced use cases, you can override defaults. See `template-env` for all options:

- **Custom Ports**: `VSB_SMTP_PORT`, `VSB_SERVER_PORT`, `VSB_SERVER_HTTPS_PORT`
- **TTL Settings**: `VSB_LOCAL_INBOX_MAX_TTL` - Max email retention
- **CORS**: `VSB_SERVER_ORIGIN=https://specific-domain.com` - Restrict origins
- **Data Path**: `VSB_DATA_PATH=/custom/path` - For non-Docker deployments

## Documentation

- **Detailed Documentation**: Visit [vaultsandbox.dev](https://vaultsandbox.dev) for comprehensive guides
- **template-env**: Example environment configuration with all available options
- **API Documentation**: Available at `/api-docs` when running in development mode

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

### Option 1: Backend + Frontend (Full Stack)

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

### Option 2: Docker Development

```bash
# Build and run development container
docker build --target development -t vaultsandbox-gateway:dev .
docker run -p 80:80 -p 443:443 -p 25:25 --env-file .env vaultsandbox-gateway:dev
```

## Docker Deployment

### Option 1: VSX DNS (Recommended)

**Zero-config setup with automatic DNS.** Your public IP is encoded into a subdomain (e.g., `1mzhr2y.vsx.email`) with proper MX records.

```yaml
# docker-compose.yml
services:
  gateway:
    image: vaultsandbox/gateway:latest
    container_name: vaultsandbox-gateway
    restart: unless-stopped
    ports:
      - "25:25"     # SMTP
      - "80:80"     # HTTP (ACME + VSX verification)
      - "443:443"   # HTTPS (Web UI + API)
    environment:
      VSB_VSX_DNS_ENABLED: "true"
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

# Retrieve API key
docker compose exec gateway cat /app/data/.api-key; echo
```

You can also find your domain by entering your IP at [vsx.email](https://vsx.email).

### Option 2: Custom Domain

**Use your own domain** for branding or compliance. Requires DNS configuration.

**DNS Requirements:** Configure these records before starting:
- **A record:** `qa.mydomain.com` → your server IP
- **MX record:** `qa.mydomain.com` → `qa.mydomain.com` (priority 10)

```yaml
# docker-compose.yml
services:
  gateway:
    image: vaultsandbox/gateway:latest
    container_name: vaultsandbox-gateway
    restart: unless-stopped
    ports:
      - "25:25"     # SMTP
      - "80:80"     # HTTP (ACME challenges)
      - "443:443"   # HTTPS (Web UI + API)
    environment:
      VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS: "qa.mydomain.com"
      VSB_CERT_ENABLED: "true"
    volumes:
      - gateway-data:/app/data

volumes:
  gateway-data:
```

```bash
# Start the gateway
docker compose up -d

# Retrieve API key
docker compose exec gateway cat /app/data/.api-key; echo
```

### Using Docker CLI

```bash
# Pull the latest image from Docker Hub
docker pull vaultsandbox/gateway:latest

# Create a volume for persistence
docker volume create gateway-data

# VSX DNS mode (recommended)
docker run -d \
  --name vaultsandbox-gateway \
  -p 25:25 -p 80:80 -p 443:443 \
  -e VSB_VSX_DNS_ENABLED="true" \
  -v gateway-data:/app/data \
  --restart unless-stopped \
  vaultsandbox/gateway:latest

# Or custom domain mode
# docker run -d \
#   --name vaultsandbox-gateway \
#   -p 25:25 -p 80:80 -p 443:443 \
#   -e VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS="qa.example.com" \
#   -e VSB_CERT_ENABLED="true" \
#   -v gateway-data:/app/data \
#   --restart unless-stopped \
#   vaultsandbox/gateway:latest

# View logs
docker logs -f vaultsandbox-gateway
```

### Port Mapping

| Port | Protocol | Purpose |
|------|----------|---------|
| `25` | SMTP | Email reception |
| `80` | HTTP | ACME challenges, redirects to HTTPS |
| `443` | HTTPS | Web UI (`/app`), REST API, health checks |

### Volume Persistence

Use a named volume mounted to `/app/data` to persist:
- TLS certificates (auto-renewed by Let's Encrypt)
- Auto-generated API key
- ACME challenge responses

## Support & Contributing

- **Documentation**: [vaultsandbox.dev/gateway](https://vaultsandbox.dev/gateway/)
- **Issues**: [github.com/vaultsandbox/gateway/issues](https://github.com/vaultsandbox/gateway/issues)
- **Discussions**: [github.com/vaultsandbox/gateway/discussions](https://github.com/vaultsandbox/gateway/discussions)
- **Website**: [vaultsandbox.com](https://www.vaultsandbox.com)

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](./LICENSE) file for details.
