import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { ChaosConfigRequest, ChaosConfigResponse } from '../interfaces/chaos.interfaces';

/**
 * Service for managing chaos engineering configuration per inbox.
 * Provides methods to get, set, and disable chaos configuration.
 */
@Injectable({ providedIn: 'root' })
export class ChaosService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  /**
   * Builds the base URL for chaos API endpoints.
   * @param emailAddress The inbox email address
   * @returns The base URL for chaos endpoints
   */
  private getBaseUrl(emailAddress: string): string {
    return `${this.baseUrl}/inboxes/${encodeURIComponent(emailAddress)}/chaos`;
  }

  /**
   * Gets the current chaos configuration for an inbox.
   * @param emailAddress The inbox email address
   * @returns Observable of the chaos configuration
   */
  get(emailAddress: string): Observable<ChaosConfigResponse> {
    return this.http.get<ChaosConfigResponse>(this.getBaseUrl(emailAddress));
  }

  /**
   * Sets the chaos configuration for an inbox.
   * @param emailAddress The inbox email address
   * @param config The chaos configuration to set
   * @returns Observable of the updated chaos configuration
   */
  set(emailAddress: string, config: ChaosConfigRequest): Observable<ChaosConfigResponse> {
    return this.http.post<ChaosConfigResponse>(this.getBaseUrl(emailAddress), config);
  }

  /**
   * Disables all chaos for an inbox.
   * @param emailAddress The inbox email address
   * @returns Observable that completes when chaos is disabled
   */
  disable(emailAddress: string): Observable<void> {
    return this.http.delete<void>(this.getBaseUrl(emailAddress));
  }
}
