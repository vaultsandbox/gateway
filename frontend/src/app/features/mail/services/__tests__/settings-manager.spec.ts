import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { SettingsManager } from '../settings-manager';
import { ServerInfoService } from '../server-info.service';
import { ServerInfoServiceStub } from '../../../../../testing/mail-testing.mocks';

describe('SettingsManager', () => {
  let service: SettingsManager;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: ServerInfoService, useClass: ServerInfoServiceStub }],
    });
    service = TestBed.inject(SettingsManager);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
