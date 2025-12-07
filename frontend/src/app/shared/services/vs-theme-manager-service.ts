import { Injectable } from '@angular/core';

const VAULTSANDBOX_THEME = 'VAULTSANDBOX_THEME';

/**
 * Persists and toggles the VaultSandbox light/dark theme flag.
 */
@Injectable({
  providedIn: 'root',
})
export class VsThemeManagerService {
  /**
   * Applies the persisted theme once during bootstrap.
   */
  init() {
    this.loadTheme();
  }

  /**
   * Loads the persisted theme preference and applies the relevant class.
   */
  private loadTheme() {
    const theme = localStorage.getItem(VAULTSANDBOX_THEME);
    if (theme) {
      if (theme === 'dark') {
        this.applyDarkTheme();
      }
      if (theme === 'light') {
        this.applyLightTheme();
      }
    }
  }

  /**
   * Adds the dark-mode class to the `<html>` element if needed.
   */
  private applyDarkTheme() {
    const htmlElement = document.querySelector('html');
    if (htmlElement && !htmlElement.classList.contains('vs-app-dark')) {
      htmlElement.classList.add('vs-app-dark');
    }
  }

  /**
   * Removes the dark-mode class from the `<html>` element.
   */
  private applyLightTheme() {
    const htmlElement = document.querySelector('html');
    if (htmlElement && htmlElement.classList.contains('vs-app-dark')) {
      htmlElement.classList.remove('vs-app-dark');
    }
  }

  /**
   * Indicates whether the UI currently renders in dark mode.
   *
   * @returns True when the dark class is applied.
   */
  public isDarkMode(): boolean {
    const htmlElement = document.querySelector('html');
    return htmlElement?.classList.contains('vs-app-dark') ?? false;
  }

  /**
   * Toggles between light and dark themes and stores the choice.
   */
  public switchHtmlDarkLight() {
    const tElement = document.querySelector('html');
    if (tElement) {
      if (tElement.classList.toggle('vs-app-dark')) {
        localStorage.setItem(VAULTSANDBOX_THEME, 'dark');
      } else {
        localStorage.setItem(VAULTSANDBOX_THEME, 'light');
      }
    }
  }
}
