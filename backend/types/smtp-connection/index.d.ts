declare module 'smtp-connection' {
  import { EventEmitter } from 'events';
  import type { ConnectionOptions } from 'tls';
  import type { Readable } from 'stream';

  export interface SMTPConnectionOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    name?: string;
    ignoreTLS?: boolean;
    requireTLS?: boolean;
    opportunisticTLS?: boolean;
    tls?: ConnectionOptions;
    socketTimeout?: number;
    logger?: boolean;
  }

  export interface Envelope {
    from?: string | false;
    to?: string[];
  }

  export interface SendResponse {
    accepted: Array<string | Buffer>;
    rejected: Array<string | Buffer>;
    response: string;
  }

  class SMTPConnection extends EventEmitter {
    constructor(options?: SMTPConnectionOptions);

    connect(callback?: (error?: Error | null) => void): void;
    send(
      envelope: Envelope,
      message: Buffer | string | Readable,
      callback: (error: Error | null, info: SendResponse) => void,
    ): void;
    quit(): void;
    close(): void;
  }

  export = SMTPConnection;
}
