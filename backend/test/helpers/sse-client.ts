import type { App } from 'supertest/types';
import http from 'http';
import appConfig from '../../src/app.config';

export interface SSEMessage {
  data: any;
  event?: string;
  id?: string;
  retry?: number;
}

export interface SSEClientOptions {
  apiKey?: string;
  inboxes?: string[];
  timeout?: number;
}

/**
 * Simple SSE client for testing Server-Sent Events endpoints
 */
export class SSEClient {
  private readonly server: http.Server | App;
  private readonly options: Required<Omit<SSEClientOptions, 'inboxes'>> & { inboxes?: string[] };
  private request?: http.ClientRequest;
  private response?: http.IncomingMessage;
  private buffer = '';
  private listeners: Map<string, Array<(message: SSEMessage) => void>> = new Map();
  private errorHandler?: (error: Error) => void;

  constructor(server: http.Server | App, options: SSEClientOptions = {}) {
    this.server = server;
    const config = appConfig();
    const defaultApiKey = config.local.apiKey || 'vsb-e2e-api-key';
    this.options = {
      apiKey: options.apiKey || defaultApiKey,
      timeout: options.timeout ?? 30000,
      inboxes: options.inboxes,
    };
  }

  /**
   * Connect to the SSE endpoint
   */
  connect(path = '/api/events'): Promise<void> {
    return new Promise((resolve, reject) => {
      // Build query string
      const queryParams = new URLSearchParams();
      if (this.options.inboxes && this.options.inboxes.length > 0) {
        queryParams.set('inboxes', this.options.inboxes.join(','));
      }
      const queryString = queryParams.toString();
      const fullPath = queryString ? `${path}?${queryString}` : path;

      // Get the HTTP server - handle both http.Server and supertest App
      let httpServer: http.Server;
      if ('address' in this.server && typeof this.server.address === 'function') {
        // It's an http.Server
        httpServer = this.server as http.Server;
      } else {
        reject(new Error('Server must be an http.Server instance. Use appLifecycle.actualHttpServer'));
        return;
      }

      // Get the address
      const address = httpServer.address();
      if (!address) {
        reject(new Error('Server not listening'));
        return;
      }
      const port = typeof address === 'string' ? 0 : address.port;

      this.request = http.request(
        {
          hostname: 'localhost',
          port,
          path: fullPath,
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'x-api-key': this.options.apiKey,
          },
          timeout: this.options.timeout,
        },
        (response) => {
          this.response = response;

          if (response.statusCode !== 200) {
            reject(new Error(`SSE connection failed with status ${response.statusCode}`));
            return;
          }

          resolve();

          response.on('data', (chunk: Buffer) => {
            this.buffer += chunk.toString('utf-8');
            this.processBuffer();
          });

          response.on('error', (error) => {
            if (this.errorHandler) {
              this.errorHandler(error);
            }
          });
        },
      );

      this.request.on('error', (error) => {
        reject(error);
      });

      this.request.end();
    });
  }

  /**
   * Listen for messages
   */
  onMessage(callback: (message: SSEMessage) => void): void {
    if (!this.listeners.has('message')) {
      this.listeners.set('message', []);
    }
    this.listeners.get('message')!.push(callback);
  }

  /**
   * Listen for errors
   */
  onError(callback: (error: Error) => void): void {
    this.errorHandler = callback;
  }

  /**
   * Wait for a single message
   */
  waitForMessage(timeoutMs = 10000): Promise<SSEMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for SSE message'));
      }, timeoutMs);

      this.onMessage((message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    });
  }

  /**
   * Wait for multiple messages
   */
  waitForMessages(count: number, timeoutMs = 10000): Promise<SSEMessage[]> {
    return new Promise((resolve, reject) => {
      const messages: SSEMessage[] = [];
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for ${count} SSE messages (received ${messages.length})`));
      }, timeoutMs);

      this.onMessage((message) => {
        messages.push(message);
        if (messages.length >= count) {
          clearTimeout(timeout);
          resolve(messages);
        }
      });
    });
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.request) {
      this.request.destroy();
      this.request = undefined;
    }
    if (this.response) {
      this.response.destroy();
      this.response = undefined;
    }
    this.buffer = '';
    this.listeners.clear();
  }

  /**
   * Process buffered SSE data
   */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    let message: Partial<SSEMessage> = {};

    for (const line of lines) {
      if (line.trim() === '') {
        // Empty line marks end of message
        if (Object.keys(message).length > 0) {
          this.emitMessage(message as SSEMessage);
          message = {};
        }
        continue;
      }

      // Parse SSE field
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const field = line.substring(0, colonIndex);
      const value = line.substring(colonIndex + 1).trim();

      switch (field) {
        case 'data':
          try {
            message.data = JSON.parse(value);
          } catch {
            message.data = value;
          }
          break;
        case 'event':
          message.event = value;
          break;
        case 'id':
          message.id = value;
          break;
        case 'retry':
          message.retry = parseInt(value, 10);
          break;
      }
    }
  }

  /**
   * Emit message to listeners
   */
  private emitMessage(message: SSEMessage): void {
    const listeners = this.listeners.get('message') || [];
    for (const callback of listeners) {
      callback(message);
    }
  }
}

/**
 * Create an SSE client for testing
 * @param server - The actual HTTP server (use appLifecycle.actualHttpServer)
 */
export function createSSEClient(server: http.Server | App, options?: SSEClientOptions): SSEClient {
  return new SSEClient(server, options);
}
