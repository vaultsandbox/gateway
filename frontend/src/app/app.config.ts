import {
  APP_INITIALIZER,
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { routes } from './app.routes';
import { apiKeyInterceptor } from './shared/interceptors/api-key.interceptor';
import { definePreset } from '@primeuix/themes';
import { MessageService, ConfirmationService } from 'primeng/api';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { VsThemeManagerService } from './shared/services/vs-theme-manager-service';
import { ServerInfoService } from './features/mail/services/server-info.service';

const gVsPreset = definePreset(Aura, {
  semantic: {
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e3e8f0',
          300: '#cbd6e2',
          400: '#95a5b9',
          500: '#66788d',
          600: '#4a586c',
          700: '#364558;',
          800: '#212d3f',
          900: '#0c1c2f',
          950: '#060b1c',
        },
        primary: {
          50: '#e1f8fd',
          100: '#b4edf9',
          200: '#84e1f4',
          300: '#53d4ee',
          400: '#30cbe8',
          500: '#1cc2e3', ///
          600: '#17b2cf',
          700: '#0f9db4',
          800: '#09899b',
          900: '#00666f',
          950: '#00484e',
        },
      },
      dark: {
        surface: {
          0: '#ffffff',
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e3e8f0',
          300: '#cbd6e2',
          400: '#95a5b9',
          500: '#66788d',
          600: '#4a586c',
          700: '#364558;',
          800: '#212d3f',
          900: '#0c1c2f',
          950: '#060b1c',
        },
        primary: {
          50: '#e1f8fd',
          100: '#b4edf9',
          200: '#84e1f4',
          300: '#53d4ee',
          400: '#30cbe8',
          500: '#1cc2e3', ///
          600: '#17b2cf',
          700: '#0f9db4',
          800: '#09899b',
          900: '#00666f',
          950: '#00484e',
        },
      },
    },
  },
});

const initTheme = (vsThemeManagerService: VsThemeManagerService) => () => vsThemeManagerService.init();

const initServerInfo = (serverInfoService: ServerInfoService) => () => serverInfoService.getServerInfo();

export const appConfig: ApplicationConfig = {
  providers: [
    MessageService,
    ConfirmationService,
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideAnimationsAsync(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([apiKeyInterceptor])),
    providePrimeNG({
      ripple: true,
      theme: {
        preset: gVsPreset,
        options: {
          darkModeSelector: '.vs-app-dark',
          cssLayer: {
            name: 'primeng',
            order: 'theme, base, primeng',
          },
        },
      },
    }),
    {
      provide: APP_INITIALIZER,
      useFactory: initTheme,
      deps: [VsThemeManagerService],
      multi: true,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initServerInfo,
      deps: [ServerInfoService],
      multi: true,
    },
  ],
};
