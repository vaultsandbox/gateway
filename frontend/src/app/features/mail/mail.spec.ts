import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Mail } from './mail';
import { MailManager } from './services/mail-manager';
import { VaultSandbox } from '../../shared/services/vault-sandbox';
import { VsThemeManagerService } from '../../shared/services/vs-theme-manager-service';
import { VsToast } from '../../shared/services/vs-toast';
import { ConfirmationService } from 'primeng/api';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import {
  MailManagerStub,
  VaultSandboxStub,
  VsThemeManagerServiceStub,
  VsToastStub,
} from '../../../testing/mail-testing.mocks';

describe('Mail', () => {
  let component: Mail;
  let fixture: ComponentFixture<Mail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Mail, HttpClientTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        ConfirmationService,
        { provide: MailManager, useClass: MailManagerStub },
        { provide: VaultSandbox, useClass: VaultSandboxStub },
        { provide: VsThemeManagerService, useClass: VsThemeManagerServiceStub },
        { provide: VsToast, useClass: VsToastStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Mail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
