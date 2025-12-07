import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { VaultSandbox } from '../vault-sandbox';

describe('VaultSandbox', () => {
  let service: VaultSandbox;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    service = TestBed.inject(VaultSandbox);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
