import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller()
export class AppController {
  constructor() {}

  /**
   * Index HTML
   */
  @Get()
  @Header('Content-Type', 'text/html')
  getIndex(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VaultSandbox</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="alternate icon" href="/favicon.ico">
  <style>
    body {
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #060B1C 10%,  #0C1C2F 100%);
    }
    .container {
      text-align: center;
      color: white;
    }
    .logo-link {
      display: inline-block;
      padding: 0.5rem;
      border-radius: 16px;
      text-decoration: none;
    }
    .logo-link:focus-visible {
      outline: 2px solid #1cc2e3;
      outline-offset: 6px;
      box-shadow: 0 0 0 6px rgba(28, 194, 227, 0.1);
    }
    .logo {
      width: 156px;
      height: 156px;
      margin-bottom: 2rem;
      filter: drop-shadow(0 10px 20px rgba(0,0,0,0.35));
      transition: transform 0.2s ease, filter 0.2s ease;
      cursor: pointer;
    }
    .logo-link:hover .logo,
    .logo-link:focus-visible .logo {
      animation: pulse 2.6s ease-in-out infinite;
      transform: scale(1.05);
      filter: drop-shadow(0 14px 28px rgba(0,0,0,0.4));
    }
    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
        filter: drop-shadow(0 10px 20px rgba(0,0,0,0.35));
      }
      50% {
        transform: scale(1.06);
        filter: drop-shadow(0 14px 28px rgba(0,0,0,0.45));
      }
    }
  </style>
</head>
<body>
  <div class="container">
   <a class="logo-link" href="/app" aria-label="Open VaultSandbox app">
    <svg class="logo" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 64 64">
  <defs>
    <style>
      .st0 {
        fill: #1cc2e3;
      }
    </style>
  </defs>
    <path class="st0" d="M60.35,46.72c-.15-.64-.53-1.18-1.09-1.53l-10.29-6.45,10.14-5.58c.78-.43,1.27-1.25,1.27-2.15s-.49-1.72-1.27-2.15l-25.94-14.28c-.74-.41-1.62-.41-2.37,0L4.87,28.86c-.78.43-1.27,1.26-1.27,2.15s.49,1.72,1.27,2.15l10.15,5.59-10.29,6.44c-1.15.72-1.49,2.23-.78,3.38.72,1.15,2.23,1.49,3.38.78l12.6-7.89,10.87,5.98c.72.4,1.65.4,2.37,0l10.87-5.99,12.61,7.9c.4.25.84.38,1.3.38.18,0,.37-.02.55-.06.64-.15,1.18-.53,1.53-1.09.35-.56.46-1.21.31-1.85ZM52.84,31.01l-20.85,11.48-20.85-11.48,20.85-11.48,20.85,11.48Z"/>
    </svg>
   </a>
  </div>
</body>
</html>
    `;
  }

  /* c8 ignore start */
  /**
   * FAVICON - SVG (modern browsers)
   */
  @Get('/favicon.svg')
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'public, max-age=31536000')
  getFaviconSvg(): string {
    return `
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 64 64">
  <!-- Generator: Adobe Illustrator 29.0.0, SVG Export Plug-In . SVG Version: 2.1.0 Build 186)  -->
  <defs>
    <style>
      .st0 {
        fill: #0c1c2f;
      }

      .st1 {
        fill: #1cc2e3;
      }
    </style>
  </defs>
  <rect class="st0" y="0" width="64" height="64"/>
  <path class="st1" d="M49.44,41.05c-.09-.39-.33-.73-.67-.94l-6.33-3.97,6.24-3.43c.48-.27.78-.77.78-1.32s-.3-1.06-.78-1.32l-15.95-8.78c-.46-.25-1-.25-1.45,0l-15.95,8.78c-.48.27-.78.77-.78,1.32s.3,1.06.78,1.32l6.24,3.44-6.33,3.96c-.7.44-.92,1.37-.48,2.08.44.7,1.37.92,2.08.48l7.75-4.85,6.68,3.68c.44.24,1.01.24,1.46,0l6.69-3.68,7.75,4.86c.24.15.52.23.8.23.11,0,.23-.01.34-.04.39-.09.73-.33.94-.67.21-.34.28-.75.19-1.14ZM44.82,31.39l-12.82,7.06-12.82-7.06,12.82-7.06,12.82,7.06Z"/>
</svg>
    `;
  }
  /* c8 ignore stop */

  /* c8 ignore start */
  /**
   * FAVICON - ICO (legacy browsers)
   */
  @Get('/favicon.ico')
  faviconIco(@Res() res: Response): void {
    res.sendFile(join(__dirname, '..', 'assets', 'favicon.ico'));
  }
  /* c8 ignore stop */
}
