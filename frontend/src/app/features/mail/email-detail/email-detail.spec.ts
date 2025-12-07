import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { EmailDetail } from './email-detail';
import { MailManager } from '../services/mail-manager';
import { SettingsManager } from '../services/settings-manager';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { VsToast } from '../../../shared/services/vs-toast';
import {
  MailManagerStub,
  SettingsManagerStub,
  VaultSandboxApiStub,
  VsToastStub,
} from '../../../../testing/mail-testing.mocks';

describe('EmailDetail', () => {
  let component: EmailDetail;
  let fixture: ComponentFixture<EmailDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailDetail],
      providers: [
        provideZonelessChangeDetection(),
        ConfirmationService,
        { provide: MailManager, useClass: MailManagerStub },
        { provide: SettingsManager, useClass: SettingsManagerStub },
        { provide: VaultSandboxApi, useClass: VaultSandboxApiStub },
        { provide: VsToast, useClass: VsToastStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailDetail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
