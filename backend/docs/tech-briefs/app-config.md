# App Configuration

Centralized configuration loader that validates and structures all environment variables at startup.

## Architecture

```
                         ┌─────────────────────────────────────────┐
                         │           app.config.ts                 │
                         │      registerAs('vsb', () => {...})     │
                         └─────────────────────────────────────────┘
                                           │
        ┌──────────────┬──────────────┬────┴────┬──────────────┬──────────────┐
        ▼              ▼              ▼         ▼              ▼              ▼
┌──────────────┐┌──────────────┐┌──────────┐┌──────────┐┌──────────────┐┌──────────┐
│buildMainConfig││buildSmtpConfig││buildLocal││buildCert ││buildOrchest- ││ others   │
│  (server)    ││  (smtp)      ││ModeConfig││Config    ││ rationConfig ││          │
└──────────────┘└──────────────┘└──────────┘└──────────┘└──────────────┘└──────────┘
```

## How It Works

1. **Startup**: NestJS loads `app.config.ts` via `@nestjs/config`
2. **Parsing**: Each `build*Config()` function reads env vars using helper parsers
3. **Validation**: Invalid/missing required values throw errors immediately (fail-fast)
4. **Registration**: Config registered under `'vsb'` namespace, accessible via `ConfigService`

## Configuration Sections

| Builder | Namespace | Purpose |
|---------|-----------|---------|
| `buildMainConfig()` | `vsb.main` | HTTP/HTTPS ports, CORS origin, gateway mode |
| `buildSmtpConfig()` | `vsb.smtp` | SMTP server settings, TLS, security controls |
| `buildLocalModeConfig()` | `vsb.local` | API key, inbox TTL, cleanup intervals |
| `buildCertificateConfig()` | `vsb.certificate` | ACME/Let's Encrypt settings |
| `buildOrchestrationConfig()` | `vsb.orchestration` | Cluster coordination, leadership |
| `buildCryptoConfig()` | `vsb.crypto` | ML-DSA-65 signing key paths |
| `buildThrottleConfig()` | `vsb.throttle` | API rate limiting |
| `buildSmtpRateLimitConfig()` | `vsb.smtpRateLimit` | SMTP per-IP limits |
| `buildSseConsoleConfig()` | `vsb.sseConsole` | SSE logging toggle |

## Parser Helpers

Located in `src/config/config.parsers.ts`:

```typescript
parseOptionalBoolean(value, default)   // "true"/"false" → boolean
parseNumberWithDefault(value, default) // string → number with fallback
parseStringWithDefault(value, default) // string with fallback
parseAllowedDomains()                  // CSV → string[] (validates format)
parseDisabledCommands(defaults)        // CSV → string[]
```

## Validation Helpers

Located in `src/config/config.validators.ts`:

```typescript
isValidDomain(domain)          // RFC-compliant domain check
validateTlsConfig(port, secure) // Warn on port/secure mismatches
```

## Fail-Fast Validation

The config throws at startup for critical misconfigurations:

| Condition | Error |
|-----------|-------|
| `VSB_SMTP_SECURE=true` without TLS creds or cert management | Requires TLS setup |
| `VSB_GATEWAY_MODE=backend` without backend URL/key | Backend config required |
| `VSB_CERT_ENABLED=true` without email or domain | ACME requires email + domain |
| `VSB_LOCAL_API_KEY` < 32 characters | Key too short |
| `VSB_LOCAL_API_KEY_STRICT=true` without explicit key | No auto-generation in strict mode |

## API Key Loading (Local Mode)

Precedence order:
1. `VSB_LOCAL_API_KEY` env var (explicit)
2. `${VSB_DATA_PATH}/.api-key` file (persisted)
3. Auto-generate + persist (first run)

Keys are never logged. Use `cat ${VSB_DATA_PATH}/.api-key` to view.

## Usage in Code

```typescript
@Injectable()
export class MyService {
  constructor(private configService: ConfigService) {}

  getSmtpPort(): number {
    return this.configService.get<number>('vsb.smtp.port');
  }

  getApiKey(): string {
    return this.configService.get<string>('vsb.local.apiKey');
  }
}
```

## Key Files

| File | Responsibility |
|------|----------------|
| `app.config.ts` | Main config registration, all builder functions |
| `config/config.constants.ts` | Default values |
| `config/config.parsers.ts` | Env var parsing utilities |
| `config/config.validators.ts` | Validation functions |
| `config/config.utils.ts` | TLS builder, node ID generator |
