import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VaultSandboxApi } from './vault-sandbox-api';
import { ServerInfo } from '../interfaces';
import { VaultSandbox } from '../../../shared/services/vault-sandbox';
import { HttpErrorResponse } from '@angular/common/http';

@Injectable({
  providedIn: 'root',
})
export class ServerInfoService {
  private readonly api = inject(VaultSandboxApi);
  private readonly vaultSandbox = inject(VaultSandbox);
  private readonly serverInfoSignal = signal<ServerInfo | null>(null);
  private ongoingFetch: Promise<ServerInfo | null> | null = null;

  /**
   * Returns a readonly signal with the cached server info.
   */
  get serverInfo() {
    return this.serverInfoSignal.asReadonly();
  }

  /**
   * Returns server info, fetching it if necessary.
   * If a 401 Unauthorized error occurs, logs the user out.
   */
  async getServerInfo(forceRefresh = false): Promise<ServerInfo | null> {
    const cached = this.serverInfoSignal();
    if (cached && !forceRefresh) {
      return cached;
    }

    if (!this.ongoingFetch || forceRefresh) {
      this.ongoingFetch = firstValueFrom(this.api.getServerInfo())
        .then((info) => {
          this.serverInfoSignal.set(info);
          return info;
        })
        .catch((error) => {
          console.error('[ServerInfoService] Error fetching server info', error);

          // If unauthorized, clear API key and logout
          if (error instanceof HttpErrorResponse && error.status === 401) {
            console.warn('[ServerInfoService] Unauthorized - clearing API key');
            this.vaultSandbox.clearApiKey();
          }

          return this.serverInfoSignal();
        })
        .finally(() => {
          this.ongoingFetch = null;
        });
    }

    return this.ongoingFetch;
  }
}
