import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { EmailList } from './email-list';
import { MailManager } from '../services/mail-manager';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { VsToast } from '../../../shared/services/vs-toast';
import { MailManagerStub, VaultSandboxApiStub, VsToastStub } from '../../../../testing/mail-testing.mocks';

describe('EmailList', () => {
  let component: EmailList;
  let fixture: ComponentFixture<EmailList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailList],
      providers: [
        provideZonelessChangeDetection(),
        ConfirmationService,
        { provide: MailManager, useClass: MailManagerStub },
        { provide: VaultSandboxApi, useClass: VaultSandboxApiStub },
        { provide: VsToast, useClass: VsToastStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
