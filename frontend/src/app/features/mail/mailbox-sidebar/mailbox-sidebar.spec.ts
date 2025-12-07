import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MailboxSidebar } from './mailbox-sidebar';
import { ConfirmationService } from 'primeng/api';
import { MailManager } from '../services/mail-manager';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { ServerInfoService } from '../services/server-info.service';
import { VsToast } from '../../../shared/services/vs-toast';
import {
  MailManagerStub,
  VaultSandboxApiStub,
  ServerInfoServiceStub,
  VsToastStub,
} from '../../../../testing/mail-testing.mocks';

describe('MailboxSidebar', () => {
  let component: MailboxSidebar;
  let fixture: ComponentFixture<MailboxSidebar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MailboxSidebar],
      providers: [
        provideZonelessChangeDetection(),
        ConfirmationService,
        { provide: MailManager, useClass: MailManagerStub },
        { provide: VaultSandboxApi, useClass: VaultSandboxApiStub },
        { provide: ServerInfoService, useClass: ServerInfoServiceStub },
        { provide: VsToast, useClass: VsToastStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MailboxSidebar);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
