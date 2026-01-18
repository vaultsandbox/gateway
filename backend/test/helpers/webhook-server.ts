import * as http from 'node:http';

export interface WebhookRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  timestamp: Date;
}

export interface WebhookServerOptions {
  responseCode?: number;
  responseDelay?: number;
  responseBody?: string;
}

/**
 * Mock HTTP server for testing webhook deliveries.
 * Captures incoming requests and allows configuring responses.
 */
export class MockWebhookServer {
  private server: http.Server | null = null;
  private receivedRequests: WebhookRequest[] = [];
  private responseCode = 200;
  private responseDelay = 0;
  private responseBody = '{"ok": true}';
  private port = 0;

  /**
   * Start the mock server on a random available port.
   * @returns The base URL of the server (e.g., "http://127.0.0.1:12345")
   */
  async start(port?: number): Promise<string> {
    if (this.server) {
      throw new Error('Server already started');
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);

      this.server.listen(port ?? 0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (typeof address === 'object' && address !== null) {
          this.port = address.port;
          resolve(`http://127.0.0.1:${this.port}`);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  /**
   * Stop the mock server.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          this.port = 0;
          resolve();
        }
      });
    });
  }

  /**
   * Get all received requests.
   */
  getRequests(): WebhookRequest[] {
    return [...this.receivedRequests];
  }

  /**
   * Get the most recent request, or undefined if none received.
   */
  getLastRequest(): WebhookRequest | undefined {
    return this.receivedRequests[this.receivedRequests.length - 1];
  }

  /**
   * Clear all recorded requests.
   */
  clearRequests(): void {
    this.receivedRequests = [];
  }

  /**
   * Set the HTTP response code for subsequent requests.
   */
  setResponseCode(code: number): void {
    this.responseCode = code;
  }

  /**
   * Set a delay (in ms) before responding to requests.
   * Useful for testing timeouts.
   */
  setResponseDelay(ms: number): void {
    this.responseDelay = ms;
  }

  /**
   * Set the response body for subsequent requests.
   */
  setResponseBody(body: string): void {
    this.responseBody = body;
  }

  /**
   * Reset all response settings to defaults.
   */
  resetResponseSettings(): void {
    this.responseCode = 200;
    this.responseDelay = 0;
    this.responseBody = '{"ok": true}';
  }

  /**
   * Get the port the server is listening on.
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Wait for a specific number of requests to be received.
   * @param count Number of requests to wait for
   * @param timeoutMs Maximum time to wait (default: 5000ms)
   */
  async waitForRequests(count: number, timeoutMs = 5000): Promise<WebhookRequest[]> {
    const startTime = Date.now();
    while (this.receivedRequests.length < count) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout waiting for ${count} requests. Received ${this.receivedRequests.length} requests.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.getRequests();
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      const request: WebhookRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
        timestamp: new Date(),
      };

      this.receivedRequests.push(request);

      const sendResponse = () => {
        res.statusCode = this.responseCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(this.responseBody);
      };

      if (this.responseDelay > 0) {
        setTimeout(sendResponse, this.responseDelay);
      } else {
        sendResponse();
      }
    });
  }
}

export function createMockWebhookServer(): MockWebhookServer {
  return new MockWebhookServer();
}
