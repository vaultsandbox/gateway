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

  describe('init', () => {
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

    it('does not add dark class if already present', () => {
      localStorage.setItem('VAULTSANDBOX_THEME', 'dark');
      document.documentElement.classList.add('vs-app-dark');

      service.init();

      // Should still have the class, not duplicated
      expect(document.documentElement.classList.contains('vs-app-dark')).toBeTrue();
      expect(document.documentElement.className.match(/vs-app-dark/g)?.length).toBe(1);
    });

    it('does not remove dark class if not present when theme is light', () => {
      localStorage.setItem('VAULTSANDBOX_THEME', 'light');
      document.documentElement.classList.remove('vs-app-dark');

      service.init();

      expect(document.documentElement.classList.contains('vs-app-dark')).toBeFalse();
    });

    it('does nothing when no theme is stored', () => {
      localStorage.removeItem('VAULTSANDBOX_THEME');
      document.documentElement.classList.remove('vs-app-dark');

      service.init();

      expect(document.documentElement.classList.contains('vs-app-dark')).toBeFalse();
    });
  });

  describe('isDarkMode', () => {
    it('returns true when dark mode class is applied', () => {
      document.documentElement.classList.add('vs-app-dark');

      expect(service.isDarkMode()).toBeTrue();
    });

    it('returns false when dark mode class is not applied', () => {
      document.documentElement.classList.remove('vs-app-dark');

      expect(service.isDarkMode()).toBeFalse();
    });
  });

  describe('switchHtmlDarkLight', () => {
    it('adds dark class and stores dark preference when switching to dark mode', () => {
      document.documentElement.classList.remove('vs-app-dark');

      service.switchHtmlDarkLight();

      expect(document.documentElement.classList.contains('vs-app-dark')).toBeTrue();
      expect(localStorage.getItem('VAULTSANDBOX_THEME')).toBe('dark');
    });

    it('removes dark class and stores light preference when switching to light mode', () => {
      document.documentElement.classList.add('vs-app-dark');

      service.switchHtmlDarkLight();

      expect(document.documentElement.classList.contains('vs-app-dark')).toBeFalse();
      expect(localStorage.getItem('VAULTSANDBOX_THEME')).toBe('light');
    });
  });
});
