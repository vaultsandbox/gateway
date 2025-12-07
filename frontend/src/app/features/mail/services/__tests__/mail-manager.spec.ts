import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MailManager } from '../mail-manager';
import { VaultSandboxApi } from '../vault-sandbox-api';
import { EncryptionService } from '../encryption.service';
import { VaultSandbox } from '../../../../shared/services/vault-sandbox';
import { VsToast } from '../../../../shared/services/vs-toast';
import { SettingsManager } from '../settings-manager';
import {
  EncryptionServiceStub,
  SettingsManagerStub,
  VaultSandboxApiStub,
  VaultSandboxStub,
  VsToastStub,
} from '../../../../../testing/mail-testing.mocks';

describe('MailManager', () => {
  let service: MailManager;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: VaultSandboxApi, useClass: VaultSandboxApiStub },
        { provide: EncryptionService, useClass: EncryptionServiceStub },
        { provide: VaultSandbox, useClass: VaultSandboxStub },
        { provide: VsToast, useClass: VsToastStub },
        { provide: SettingsManager, useClass: SettingsManagerStub },
      ],
    });
    service = TestBed.inject(MailManager);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
