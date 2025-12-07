import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { SettingsDialog } from './settings-dialog';
import { SettingsManager } from '../services/settings-manager';
import { ServerInfoService } from '../services/server-info.service';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { InboxService } from '../services/inbox.service';
import { VsToast } from '../../../shared/services/vs-toast';
import {
  ServerInfoServiceStub,
  SettingsManagerStub,
  VaultSandboxApiStub,
  InboxServiceStub,
  VsToastStub,
} from '../../../../testing/mail-testing.mocks';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

describe('SettingsDialog', () => {
  let component: SettingsDialog;
  let fixture: ComponentFixture<SettingsDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsDialog],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        ConfirmationService,
        { provide: SettingsManager, useClass: SettingsManagerStub },
        { provide: ServerInfoService, useClass: ServerInfoServiceStub },
        { provide: VaultSandboxApi, useClass: VaultSandboxApiStub },
        { provide: InboxService, useClass: InboxServiceStub },
        { provide: VsToast, useClass: VsToastStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
