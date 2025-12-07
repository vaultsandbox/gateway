<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/images/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="../docs/images/logo-light.svg">
  <img alt="Project Logo" src="./docs/images/logo-dark.svg">
</picture>

# Gateway - Frontend

A modern Angular web application providing a rich user interface for the VaultSandbox Gateway SMTP server. View and manage emails, inspect authentication results (SPF, DKIM, DMARC), monitor gateway metrics, and configure inbox settings through an intuitive Material Design interface.

## Features

- **Email Management**: Browse received emails
- **Email Detail View**: Full email rendering with HTML/text views, attachments, and headers
- **Authentication Results**: Visual display of SPF, DKIM, DMARC, and reverse DNS validation
- **Custom Inboxes**: Create and manage multiple virtual inboxes
- **Real-Time Updates**: Server-Sent Events (SSE) for live email notifications
- **Gateway Metrics**: Monitor SMTP server performance and health
- **Dark/Light Theme**: Automatic theme switching based on system preferences
- **Quantum-Safe Decryption**: Support for ML-KEM-768 encrypted email payloads
- **Responsive Design**: Mobile-friendly interface built with PrimeNG and Tailwind CSS

## Tech Stack

- **Framework**: Angular 20.3
- **UI Components**: PrimeNG 20.3 with Material Aura theme
- **Styling**: Tailwind CSS 4.x with PrimeUI plugin
- **State Management**: RxJS observables and signals
- **Security**: DOMPurify for HTML sanitization
- **Cryptography**: @noble/post-quantum for ML-KEM-768 decryption
- **Testing**: Jasmine + Karma

## Monorepo Structure

```
vaultsandbox-gateway/
├── backend/           # NestJS backend (SMTP server + API)
└── frontend/          # Angular web application (this directory)
    ├── src/
    │   ├── app/
    │   │   ├── features/      # Feature modules
    │   │   │   ├── mail/      # Email management (inbox, detail, list)
    │   │   │   ├── home/      # Landing page
    │   │   │   ├── metrics-dialog/    # Gateway metrics
    │   │   │   └── sse-console/       # Real-time notifications
    │   │   └── shared/        # Shared services, components, interfaces
    │   ├── environments/      # Environment configurations
    │   └── public/            # Static assets
    └── dist/                  # Build output (served by backend)
```

## Quick Start

### Prerequisites

- Node.js 18+ (for local development)
- Backend server running (provides API at `/api`)

### Installation

```bash
# Clone the repository (if not already done)
git clone https://github.com/vaultsandbox/gateway.git
cd gateway/frontend

# Install dependencies
npm install
```

### Development

#### Option 1: Standalone Development Server

```bash
# Start Angular development server with hot reload
npm start

# Access the application
# - Web UI: http://localhost:4200
# - Proxy to backend: http://localhost:4200/api (configured in angular.json)
```

This mode provides the fastest development experience with instant hot module replacement.

#### Option 2: Full Stack Development

```bash
# Terminal 1: Start backend server
cd backend
npm run start:dev

# Terminal 2: Build frontend for backend serving
cd frontend
npm run build
# Or use watch mode for continuous rebuilds
npm run watch

# Access the application
# - Web UI: http://localhost:80/app (or configured VSB_SERVER_PORT)
# - Served by backend with production-like routing
```

This mode tests the full integration with the backend's static file serving.

#### Option 3: Remote Backend Development

Develop the frontend locally while connecting to a remote Gateway server. This is ideal for testing with real emails without needing to set up local SMTP infrastructure.

**Setup:**

1. Create a `proxy.conf.json` file in the `frontend/` directory:

```json
{
  "/api": {
    "target": "https://your-gateway-server.com",
    "secure": true,
    "changeOrigin": true
  }
}
```

2. Replace `https://your-gateway-server.com` with your remote Gateway server URL.

3. Start the development server:

```bash
npm start
```

The proxy configuration is gitignored, so your server URL won't be committed to the repository.

**Benefits:**
- Receive and view real emails from actual SMTP transactions
- Test against production-like data without local SMTP setup
- Share a staging server among multiple developers
- No need for mock data or email simulation hacks

### Building

```bash
# Production build
npm run build

# Build output location
# dist/frontend/browser/   # Static files for backend serving
```

The build artifacts are automatically served by the backend at the `/app` endpoint.

### Backend Integration

The frontend is designed to be served by the NestJS backend:

1. **Build Location**: Frontend builds to `dist/frontend/browser/`
2. **Backend Serving**: Backend serves static files at `/app` via `@nestjs/serve-static`
3. **API Proxy**:
   - Development: Angular proxy configuration redirects `/api` to backend
   - Production: Backend serves both frontend and API on same origin
4. **API Authentication**: `ApiKeyInterceptor` automatically adds `X-API-Key` header

### API Key Management

The frontend uses **browser localStorage** to persist the API key:

1. **First Launch**: User is prompted to enter API key via form
2. **Validation**: Key is validated against backend's `/api/check-key` endpoint
3. **Storage**: Valid key is stored in `localStorage` with key `vaultsandbox_api_key`
4. **Persistence**: Key is loaded from localStorage on subsequent visits
5. **Automatic Injection**: `ApiKeyInterceptor` adds key to all API requests via `X-API-Key` header

**Getting Your API Key:**

```bash
# Backend generates API key on first startup
# Check backend logs or read the key file:
cat /app/data/.api-key
```

**User Workflow:**
1. Open web interface at `https://your-domain/app`
2. Enter API key when prompted (one-time setup)
3. Key is stored in browser and used for all subsequent requests
4. No need to re-enter key unless localStorage is cleared

## Available Scripts

- `npm start` - Start development server with hot reload (port 4200)
- `npm run build` - Production build (outputs to dist/frontend/browser)
- `npm run watch` - Watch mode for continuous rebuilds
- `npm test` - Run unit tests with Karma
- `npm run test:h` - Run tests headlessly (CI mode)
- `npm run lint` - Lint code with ESLint
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

## Project Structure

### Core Features

#### Mail Feature (`src/app/features/mail/`)

The main email management interface:

- **EmailListComponent**: Inbox view
- **EmailDetailComponent**: Full email rendering with authentication results
- **MailboxSidebarComponent**: Inbox navigation and custom inbox management
- **Services**:
  - `MailManager`: Orchestrates email state and operations
  - `InboxService`: Manages inbox data
  - `EmailService`: Fetches and caches email data
  - `EncryptionService`: Decrypts quantum-safe encrypted payloads
  - `ServerInfoService`: Retrieves gateway configuration

#### Email Detail Subcomponents

- **EmailAuthResultsComponent**: Visual display of SPF, DKIM, DMARC results
- **EmailHeadersComponent**: Expandable email headers with formatting
- **EmailLinksComponent**: Extracted links with security warnings
- **EmailAttachmentsComponent**: Attachment list with download support

#### Supporting Features

- **HomeComponent**: Landing page with quick actions
- **MetricsDialogComponent**: Gateway metrics and health monitoring
- **SseConsoleComponent**: Real-time server-sent event debugging
- **NoApiKeyComponent**: API key entry form with validation and localStorage persistence

### Shared Module (`src/app/shared/`)

Reusable services and components:

- **Services**:
  - `VaultSandbox`: Manages API key persistence (localStorage), SSE connections, and real-time event handling
  - `VsThemeManagerService`: Dark/light theme management with localStorage persistence
  - `VsToastService`: Toast notification system (PrimeNG wrapper)

- **Interceptors**:
  - `ApiKeyInterceptor`: Automatically adds API key to requests

- **Interfaces**:
  - `EncryptedPayload`: Quantum-safe encryption payload structure
  - `MetricsInterfaces`: Gateway metrics types

- **Components**:
  - `VsLogoComponent`: Responsive logo with theme support

## Email Authentication Display

The frontend provides comprehensive visualization of email authentication:

### SPF (Sender Policy Framework)
- **Pass**: Green checkmark - Sender IP authorized by domain
- **Fail**: Red X - Sender IP not authorized
- **SoftFail**: Yellow warning - Policy suggests rejection but not required
- **Neutral**: Gray dash - No policy statement
- **None**: Gray dash - No SPF record found

### DKIM (DomainKeys Identified Mail)
- **Pass**: Green checkmark - Valid cryptographic signature
- **Fail**: Red X - Invalid or missing signature
- **None**: Gray dash - No DKIM signature present

### DMARC (Domain-based Message Authentication)
- **Pass**: Green checkmark - Alignment checks passed
- **Fail**: Red X - Alignment checks failed
- **None**: Gray dash - No DMARC policy found

### Reverse DNS
- **Pass**: Green checkmark - Valid PTR record for sender IP
- **Fail**: Red X - No PTR record or mismatch

## Quantum-Safe Encryption

The frontend supports decryption of quantum-safe encrypted email payloads:

### Encryption Flow (Backend → Frontend)
1. Backend encrypts email using ML-KEM-768 (NIST FIPS 203)
2. Backend signs payload using ML-DSA-65 (NIST FIPS 204)
3. Frontend receives encrypted payload via API
4. Frontend decapsulates shared secret using recipient private key
5. Frontend derives AES-256-GCM key via HKDF-SHA-512
6. Frontend decrypts and verifies email content

### Key Management
- **Development**: Ephemeral keys generated in browser
- **Production**: Private keys loaded from secure storage
- **Key Format**: Raw binary or Base64-encoded

## Styling Architecture

### Tailwind CSS 4.x
- Utility-first CSS framework with JIT compilation
- Custom theme configuration in `tailwind.config.js`
- PrimeUI plugin for PrimeNG component styling

### PrimeNG Theme
- Material Aura theme with dark/light variants
- Automatic theme switching via `VsThemeManagerService`
- Theme preference persisted to localStorage

### Custom Styling Patterns
```typescript
// Example: Conditional styling with theme awareness
<div class="bg-surface-50 dark:bg-surface-900">
  <p class="text-surface-900 dark:text-surface-0">
    Themed content
  </p>
</div>
```

## State Management

The application uses modern Angular patterns:

- **Signals**: For reactive state management (Angular 20)
- **RxJS Observables**: For asynchronous data streams
- **Services**: Singleton services for shared state

Example state management:

```typescript
// InboxService manages inbox state
export class InboxService {
  private inboxesSignal = signal<Inbox[]>([]);
  readonly inboxes = this.inboxesSignal.asReadonly();

  // Observable for async operations
  readonly emails$ = this.emailService.getEmails();
}
```

## API Key Architecture

The frontend implements a **user-managed API key system** using browser localStorage:

### Authentication Flow

1. **App Initialization**:
   - `VaultSandbox` service checks `localStorage['vaultsandbox_api_key']`
   - If key exists, it's loaded into memory as a signal
   - If no key found, app guards redirect to `NoApiKeyComponent`

2. **Key Entry** (`NoApiKeyComponent`):
   - User enters API key in a form
   - Key is validated via `POST /api/check-key` with `X-API-Key` header
   - On success: Key saved to localStorage via `VaultSandbox.setApiKey()`
   - On failure: Error message shown (401 = Invalid, other = Network/Server error)

3. **Request Authentication** (`ApiKeyInterceptor`):
   - Intercepts all HTTP requests to `/api/*` endpoints
   - Automatically adds `X-API-Key: <stored-key>` header
   - Key retrieved from `VaultSandbox.apiKey()` signal

4. **Session Persistence**:
   - Key persists across browser sessions via localStorage
   - No server-side session management required
   - User can clear key via app settings or browser localStorage

### Why localStorage?

- **User Control**: Each user manages their own API key per browser
- **No Server State**: Backend remains stateless (no sessions)
- **Development Friendly**: Developers can use different keys per browser/profile
- **Multi-Environment**: Same frontend can connect to different backends
- **Security Trade-off**: Suitable for development/testing environments (not production user auth)

### Security Considerations

- **Not for Production Auth**: localStorage is accessible via JavaScript (XSS risk)
- **Testing Environments**: Designed for QA/staging where users are trusted
- **Single API Key**: Backend typically has one API key shared by all frontend users
- **No Encryption**: Key stored in plaintext in localStorage
- **HTTPS Recommended**: Always use HTTPS to prevent key interception

## Security Features

### Input Sanitization
- **DOMPurify**: Sanitizes HTML email content before rendering
- **CSP-safe**: No inline scripts or styles in email content
- **Link Extraction**: External links displayed with security warnings

### API Security
- **API Key Authentication**: All requests authenticated via `X-API-Key` header
- **CORS**: Cross-origin requests handled by backend CORS policy
- **Rate Limiting**: Backend enforces rate limits on API endpoints

### Cryptography
- **Post-Quantum**: ML-KEM-768 for key encapsulation
- **Digital Signatures**: ML-DSA-65 for payload verification
- **AES-256-GCM**: Symmetric encryption with HKDF-SHA-512 key derivation

## Testing

### Unit Tests

```bash
# Run tests in watch mode
npm test

# Run tests headlessly (CI mode)
npm run test:h
```

Tests are located alongside their source files:
- `*.spec.ts` - Component/service tests
- `__tests__/` - Test utilities and mocks

### Test Coverage

Key testing areas:
- Email rendering and sanitization
- Authentication result formatting
- Encryption/decryption workflows
- Theme switching
- Inbox management

## Development Workflow

### Adding a New Feature

1. **Generate Component**:
   ```bash
   ng generate component features/my-feature
   ```

2. **Add Service**:
   ```bash
   ng generate service features/my-feature/services/my-service
   ```

3. **Add Route** (if needed):
   ```typescript
   // src/app/app.routes.ts
   export const routes: Routes = [
     { path: 'my-feature', component: MyFeatureComponent }
   ];
   ```

4. **Test**:
   ```bash
   npm test
   ```

### Code Style

The project uses ESLint and Prettier for consistent code formatting:

```bash
# Format code
npm run format

# Check formatting
npm run format:check

# Lint code
npm run lint
```

Configuration:
- **ESLint**: `eslint.config.js` - Angular-specific rules
- **Prettier**: `package.json` - Print width 120, single quotes

## Environment Configuration

Environment files only configure the API base URL. **API keys are NOT stored in environment files** - they are entered by users and stored in browser localStorage.

### Development Environment
```typescript
// src/environments/environment.development.ts
export const environment = {
  apiUrl: '/api',              // Proxied to backend (port 80)
};
```

### Production Environment
```typescript
// src/environments/environment.ts
export const environment = {
  apiUrl: 'https://qa.mydomain.com/api',  // Production backend URL
};
```

**Note**: The API key is managed separately via the `VaultSandbox` service and stored in `localStorage['vaultsandbox_api_key']`.

## Deployment

### Building for Production

```bash
# Build frontend
npm run build

# Build output
ls -la dist/frontend/browser/
```

### Backend Integration

The backend serves the frontend automatically:

1. **Build Location**: `dist/frontend/browser/`
2. **Backend Serving**: Via `@nestjs/serve-static` module
3. **URL**: `https://your-domain/app`
4. **Fallback**: All routes fallback to `index.html` for Angular routing

### Docker Deployment

The frontend is included in the main Docker image:

```dockerfile
# Multi-stage build (from root Dockerfile)
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Final stage
FROM node:20-alpine
COPY --from=frontend-builder /frontend/dist/frontend/browser /app/frontend
```

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile: iOS Safari, Chrome Android

## Troubleshooting

### Cannot Connect to Backend

1. **Check Backend Status**: Ensure backend is running on expected port
2. **Verify Proxy Config**: Check `angular.json` proxy configuration
3. **CORS Issues**: Ensure backend allows frontend origin

### API Key Not Working

1. **Check API Key**: Verify key matches backend `.api-key` file
2. **Check localStorage**: Open DevTools → Application → Local Storage → Check `vaultsandbox_api_key`
3. **Clear and Re-enter**: Clear localStorage and re-enter the API key
4. **Header Inspection**: Check browser DevTools Network tab for `X-API-Key` header in requests
5. **Backend Validation**: Ensure backend `/api/check-key` endpoint is accessible

### Email Content Not Rendering

1. **Sanitization**: Check browser console for DOMPurify warnings
2. **CSP**: Verify Content Security Policy allows email content
3. **Format**: Ensure backend returns valid email structure

### Theme Not Switching

1. **Service Initialization**: Check `VsThemeManagerService` initialization
2. **LocalStorage**: Verify browser allows localStorage access
3. **Theme Files**: Ensure theme CSS files are loaded

## Additional Resources

- **Backend Documentation**: See `backend/README.md` for API details
- **Main Repository**: See root `README.md` for project overview
- **Angular Documentation**: [angular.dev](https://angular.dev)
- **PrimeNG Documentation**: [primeng.org](https://primeng.org)
- **Tailwind CSS**: [tailwindcss.com](https://tailwindcss.com)

## Support & Contributing

- **Documentation**: [vaultsandbox.dev](https://vaultsandbox.dev)
- **Issues**: [github.com/vaultsandbox/gateway/issues](https://github.com/vaultsandbox/gateway/issues)
- **Discussions**: [github.com/vaultsandbox/gateway/discussions](https://github.com/vaultsandbox/gateway/discussions)

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
