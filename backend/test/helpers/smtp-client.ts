import SMTPConnection from 'smtp-connection';
import type { Envelope, SendResponse } from 'smtp-connection';
import type { ConnectionOptions } from 'tls';
import { buildEmailFixture, type EmailFixtureName, type FixtureOverrides } from './test-emails';

export interface SmtpClientOptions {
  host?: string;
  port: number;
  secure?: boolean;
  tls?: ConnectionOptions;
  name?: string;
}

export class SmtpTestClient {
  private readonly host: string;
  private readonly port: number;
  private readonly secure: boolean;
  private readonly tls?: ConnectionOptions;
  private readonly name: string;

  constructor(options: SmtpClientOptions) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port;
    this.secure = options.secure ?? false;
    this.tls = options.tls;
    this.name = options.name ?? 'vsb-e2e-smtp-client';
  }

  async sendRawEmail(raw: Buffer | string, envelope: Envelope): Promise<SendResponse> {
    const connection = this.createConnection();
    try {
      await this.connect(connection);
      const payload = typeof raw === 'string' ? Buffer.from(raw, 'utf-8') : raw;
      const response = await this.send(connection, envelope, payload);
      connection.quit();
      connection.close();
      return response;
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  async sendFixture(name: EmailFixtureName, overrides: FixtureOverrides): Promise<SendResponse> {
    const fixture = buildEmailFixture(name, overrides);
    return this.sendRawEmail(fixture.raw, fixture.envelope);
  }

  private createConnection(): SMTPConnection {
    return new SMTPConnection({
      host: this.host,
      port: this.port,
      secure: this.secure,
      name: this.name,
      tls: {
        rejectUnauthorized: false,
        ...this.tls,
      },
    });
  }

  private async connect(connection: SMTPConnection): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      connection.connect((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async send(connection: SMTPConnection, envelope: Envelope, message: Buffer): Promise<SendResponse> {
    return new Promise<SendResponse>((resolve, reject) => {
      let settled = false;

      // Handle connection close events (for chaos connection drop testing)
      const onClose = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Connection closed unexpectedly'));
        }
      };

      const onError = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      // Listen for connection events
      connection.on('close', onClose);
      connection.on('error', onError);
      connection.on('end', onClose);

      connection.send(envelope, message, (error: Error | null, info: SendResponse) => {
        // Clean up listeners
        connection.off('close', onClose);
        connection.off('error', onError);
        connection.off('end', onClose);

        if (settled) {
          return; // Already handled by event
        }
        settled = true;

        if (error) {
          reject(error);
          return;
        }
        resolve(info);
      });
    });
  }
}

export function createSmtpClient(options: SmtpClientOptions): SmtpTestClient {
  return new SmtpTestClient(options);
}
