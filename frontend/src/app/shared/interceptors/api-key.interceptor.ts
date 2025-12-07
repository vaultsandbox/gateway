import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { VaultSandbox } from '../../shared/services/vault-sandbox';

export const apiKeyInterceptor: HttpInterceptorFn = (req, next) => {
  const vaultSandbox = inject(VaultSandbox);
  const apiKey = vaultSandbox.apiKey();

  if (apiKey) {
    const clonedReq = req.clone({
      setHeaders: {
        'X-API-Key': apiKey,
      },
    });
    return next(clonedReq);
  }

  return next(req);
};
