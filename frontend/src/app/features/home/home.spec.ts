import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ConfirmationService } from 'primeng/api';
import { MailManager } from '../mail/services/mail-manager';
import { VaultSandbox } from '../../shared/services/vault-sandbox';
import { VsThemeManagerService } from '../../shared/services/vs-theme-manager-service';
import { VsToast } from '../../shared/services/vs-toast';
import {
  MailManagerStub,
  VaultSandboxStub,
  VsThemeManagerServiceStub,
  VsToastStub,
} from '../../../testing/mail-testing.mocks';

import { Home } from './home';

describe('Home', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home, HttpClientTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        ConfirmationService,
        { provide: MailManager, useClass: MailManagerStub },
        { provide: VaultSandbox, useClass: VaultSandboxStub },
        { provide: VsThemeManagerService, useClass: VsThemeManagerServiceStub },
        { provide: VsToast, useClass: VsToastStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
