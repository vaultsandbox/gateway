/**
 * VSX DNS Pre-Boot Check-In
 *
 * This module runs BEFORE NestJS boots to:
 * 1. Start a temporary HTTP server for the probe endpoint
 * 2. Check in with the VSX DNS service at api.vsx.email
 * 3. Populate process.env with discovered domain values
 * 4. Allow NestJS config to see these values during initialization
 */

import * as http from 'http';

const VSX_DNS_API_URL = 'https://api.vsx.email';
const VSX_DNS_TIMEOUT_MS = 15000; // 15 second timeout for check-in

interface CheckInResponse {
  status: 'ready' | 'error';
  ip: string;
  domain?: string;
  message?: string;
  error?: string;
  action?: string;
}

// Track active connections so we can force-close them
const activeConnections = new Set<import('net').Socket>();

/**
 * Starts a temporary HTTP server that only serves the probe endpoint.
 * This is needed because the VSX DNS service probes back to verify connectivity
 * before NestJS is ready.
 */
function startProbeServer(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/.well-known/vaultsandbox') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // Track connections so we can force-close them on shutdown
    server.on('connection', (socket) => {
      activeConnections.add(socket);
      socket.on('close', () => {
        activeConnections.delete(socket);
      });
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(port, () => {
      console.log(`[VsxDnsPreBoot] Temporary probe server started on port ${port}`);
      resolve(server);
    });
  });
}

/**
 * Stops the temporary probe server and ensures port is fully released.
 */
async function stopProbeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    // Force-close all active connections immediately
    for (const socket of activeConnections) {
      socket.destroy();
    }
    activeConnections.clear();

    server.close(() => {
      console.log('[VsxDnsPreBoot] Temporary probe server stopped');
      // Delay to ensure OS fully releases the port before NestJS binds
      setTimeout(resolve, 500);
    });
  });
}

/**
 * Performs VSX DNS check-in before NestJS boots.
 * If VSB_VSX_DNS_ENABLED=true, contacts api.vsx.email to discover domain
 * and populates process.env for NestJS config to consume.
 */
export async function vsxDnsPreBoot(): Promise<void> {
  const enabled = process.env.VSB_VSX_DNS_ENABLED?.toLowerCase() === 'true';

  if (!enabled) {
    return; // VSX DNS not enabled, skip
  }

  console.log('[VsxDnsPreBoot] VSX DNS enabled - performing check-in...');

  // Start temporary probe server on port 80 (or configured port)
  /* c8 ignore next */
  const port = parseInt(process.env.VSB_SERVER_PORT || '80', 10);
  let probeServer: http.Server | null = null;

  try {
    probeServer = await startProbeServer(port);
  } catch (err) {
    /* c8 ignore next */
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[VsxDnsPreBoot] Failed to start probe server: ${message}`);
    console.error('[VsxDnsPreBoot] Continuing without probe server - check-in may fail');
  }

  let checkInFailed = false;
  let errorBanner = '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VSX_DNS_TIMEOUT_MS);

  try {
    const response = await fetch(`${VSX_DNS_API_URL}/check-in`, {
      signal: controller.signal,
    });
    const data = (await response.json()) as CheckInResponse;

    if (data.status !== 'ready' || !data.domain) {
      // Print failure banner and exit
      /* c8 ignore next 2 */
      const errorMsg = (data.error || 'Unknown error').substring(0, 49).padEnd(49);
      const actionMsg = (data.action || 'Check your network configuration').substring(0, 48).padEnd(48);
      errorBanner = `
╔══════════════════════════════════════════════════════════════
║  VSX DNS Check-In Failed!                                    
╠══════════════════════════════════════════════════════════════
║  Error: ${errorMsg}║
║  Action: ${actionMsg}║
╚══════════════════════════════════════════════════════════════
`;
      checkInFailed = true;
    } else {
      // Success - populate environment variables
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = data.domain;
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_DOMAIN = data.domain;

      // Print success banner
      console.log(`
╔══════════════════════════════════════════════════════════════
║  VSX DNS Check-In Successful!                                
╠══════════════════════════════════════════════════════════════
║  Your Domain:  ${data.domain.padEnd(45)}
║  Public IP:    ${data.ip.padEnd(45)}
║                                                              
║  DNS is active. Certificate will be obtained automatically.  
╚══════════════════════════════════════════════════════════════
`);

      console.log(`[VsxDnsPreBoot] Domain: ${data.domain}, IP: ${data.ip}`);
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    /* c8 ignore next 2 */
    const message = isTimeout ? 'Request timed out' : error instanceof Error ? error.message : String(error);
    const action = isTimeout ? 'Check network connectivity to api.vsx.email' : 'Ensure api.vsx.email is reachable';
    const truncatedMsg = message.substring(0, 49).padEnd(49);
    const truncatedAction = action.substring(0, 48).padEnd(48);
    errorBanner = `
╔══════════════════════════════════════════════════════════════
║  VSX DNS Check-In Failed!
╠══════════════════════════════════════════════════════════════
║  Error: ${truncatedMsg}
║  Action: ${truncatedAction}║
╚══════════════════════════════════════════════════════════════
`;
    checkInFailed = true;
  } finally {
    clearTimeout(timeout);
    // Always stop the probe server before continuing or exiting
    if (probeServer) {
      await stopProbeServer(probeServer);
    }
  }

  if (checkInFailed) {
    console.error(errorBanner);
    process.exit(1);
  }
}
