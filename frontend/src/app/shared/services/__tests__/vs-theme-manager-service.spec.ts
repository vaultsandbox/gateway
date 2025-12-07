import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { VsThemeManagerService } from '../vs-theme-manager-service';

describe('VsThemeManagerService', () => {
  let service: VsThemeManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    service = TestBed.inject(VsThemeManagerService);
  });

  afterEach(() => {
    document.documentElement.classList.remove('vs-app-dark');
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('applies dark mode when user preference is dark', () => {
    localStorage.setItem('VAULTSANDBOX_THEME', 'dark');
    document.documentElement.classList.remove('vs-app-dark');

    service.init();

    expect(document.documentElement.classList.contains('vs-app-dark')).toBeTrue();
  });

  it('removes dark mode when user preference is light', () => {
    localStorage.setItem('VAULTSANDBOX_THEME', 'light');
    document.documentElement.classList.add('vs-app-dark');

    service.init();

    expect(document.documentElement.classList.contains('vs-app-dark')).toBeFalse();
  });
});
