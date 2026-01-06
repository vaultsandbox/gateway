import { randomBytes } from 'node:crypto';
import type { Envelope } from 'smtp-connection';

export type EmailFixtureName = keyof typeof EMAIL_FIXTURES;

export interface FixtureOverrides {
  to: string;
  from?: string;
  subject?: string;
  messageId?: string;
  date?: Date;
  aliasTag?: string;
  approxSizeBytes?: number;
}

export interface BuiltEmailFixture {
  name: EmailFixtureName;
  description: string;
  envelope: Envelope;
  raw: Buffer;
  headers: {
    from: string;
    to: string;
    subject: string;
    messageId: string;
    date: string;
  };
}

interface FixtureContext {
  to: string;
  from: string;
  fromAddress: string;
  subject: string;
  messageId: string;
  date: string;
  aliasAddress?: string;
  approxSizeBytes?: number;
}

interface FixtureDefinition {
  description: string;
  build: (ctx: FixtureContext) => string;
  envelope?: (ctx: FixtureContext) => Envelope;
}

const DEFAULT_FROM = 'Security Alerts <alerts@vaultsandbox.test>';

const EMAIL_FIXTURES: Record<string, FixtureDefinition> = {
  plaintext: {
    description: 'Plaintext sender notification with DKIM/SPF style headers',
    build: (ctx) => {
      return [
        baseHeaders(ctx, ctx.to),
        'Content-Type: text/plain; charset="utf-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        'Hello VaultSandbox team,',
        '',
        'This is a plaintext notification covering the default receive-only path.',
        'The body intentionally includes a few paragraphs and common headers to mimic a real outbound mail.',
        '',
        'Regards,',
        'Email Test Suite',
        '',
      ].join('\r\n');
    },
  },
  htmlWithAttachment: {
    description: 'Multipart/alternative email that contains HTML section with an attachment',
    build: (ctx) => {
      const boundary = `----=_VSBE2E_${randomBytes(6).toString('hex')}`;
      const attachmentContent = Buffer.from('Attachment payload for VaultSandbox E2E testing').toString('base64');

      return [
        baseHeaders(ctx, ctx.to),
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: multipart/alternative; boundary="alt-part"',
        '',
        '--alt-part',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Multipart body fallback for non-HTML clients.',
        '',
        '--alt-part',
        'Content-Type: text/html; charset="utf-8"',
        '',
        '<html><body><h1>VaultSandbox HTML Fixture</h1><p>This email contains HTML markup and an attachment.</p></body></html>',
        '',
        '--alt-part--',
        `--${boundary}`,
        'Content-Type: application/pdf; name="security-report.pdf"',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="security-report.pdf"',
        '',
        attachmentContent,
        `--${boundary}--`,
        '',
      ].join('\r\n');
    },
  },
  aliasRecipient: {
    description: 'Plaintext email delivered to an inbox alias using "+" tagging',
    build: (ctx) => {
      const aliasAddress = ctx.aliasAddress ?? ctx.to;
      return [
        baseHeaders(ctx, aliasAddress),
        'Content-Type: text/plain; charset="utf-8"',
        '',
        `Alias delivery test for ${aliasAddress}.`,
        '',
        'We expect VaultSandbox to normalize this back to the base inbox.',
        '',
      ].join('\r\n');
    },
    envelope: (ctx) => ({
      from: ctx.fromAddress,
      to: [ctx.aliasAddress ?? ctx.to],
    }),
  },
  oversized: {
    description: 'Large plaintext payload for exercising SMTP size guard rails',
    build: (ctx) => {
      const approxSize = ctx.approxSizeBytes ?? 1_500_000; // ~1.5MB
      const chunk = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum aliquet mattis metus.\r\n';
      const repeatCount = Math.ceil(approxSize / chunk.length);
      const repeatedBody = chunk.repeat(repeatCount);

      return [baseHeaders(ctx, ctx.to), 'Content-Type: text/plain; charset="utf-8"', '', repeatedBody, ''].join('\r\n');
    },
  },
  htmlWithUrls: {
    description: 'HTML email with embedded URLs for URL extraction testing',
    build: (ctx) => {
      const boundary = `----=_VSBE2E_${randomBytes(6).toString('hex')}`;

      return [
        baseHeaders(ctx, ctx.to),
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Check out these links:',
        'https://example.com/plain-text-url',
        'Visit https://docs.example.org/guide for documentation.',
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="utf-8"',
        '',
        '<html><body>',
        '<h1>VaultSandbox URL Extraction Test</h1>',
        '<p>Here are some links:</p>',
        '<ul>',
        '<li><a href="https://example.com/link1">Link 1</a></li>',
        '<li><a href="https://example.org/link2?query=param">Link 2 with query</a></li>',
        '<li><a href="https://test.example.net/path/to/page#anchor">Link 3 with anchor</a></li>',
        '</ul>',
        '<p>Plain text URL in HTML: https://inline.example.com/url</p>',
        '</body></html>',
        '',
        `--${boundary}--`,
        '',
      ].join('\r\n');
    },
  },
};

function baseHeaders(ctx: FixtureContext, recipient: string): string {
  const headers = [
    `From: ${ctx.from}`,
    `To: ${recipient}`,
    'Cc: engineering@vaultsandbox.test',
    `Subject: ${ctx.subject}`,
    `Message-ID: ${ctx.messageId}`,
    `Date: ${ctx.date}`,
    'MIME-Version: 1.0',
    'DKIM-Signature: v=1; a=rsa-sha256; d=vaultsandbox.test; s=default; bh=FAKEHASH==; b=FAKESIGNATURE==',
    'Received-SPF: pass (vaultsandbox-gateway) client-ip=203.0.113.5; envelope-from=alerts@vaultsandbox.test;',
  ];
  return headers.join('\r\n');
}

export function buildEmailFixture(name: EmailFixtureName, overrides: FixtureOverrides): BuiltEmailFixture {
  const definition = EMAIL_FIXTURES[name];
  if (!definition) {
    throw new Error(`Unknown email fixture: ${name}`);
  }
  if (!overrides.to) {
    throw new Error('Email fixture requires a `to` address');
  }

  const context: FixtureContext = {
    to: overrides.to,
    from: overrides.from ?? DEFAULT_FROM,
    fromAddress: extractEnvelopeAddress(overrides.from ?? DEFAULT_FROM),
    subject: overrides.subject ?? subjectForFixture(name),
    messageId: overrides.messageId ?? buildMessageId(name),
    date: (overrides.date ?? new Date()).toUTCString(),
    aliasAddress: overrides.aliasTag ? buildAliasAddress(overrides.to, overrides.aliasTag) : undefined,
    approxSizeBytes: overrides.approxSizeBytes,
  };

  const raw = definition.build(context);
  const envelope = definition.envelope?.(context) ?? {
    from: context.fromAddress,
    to: [context.aliasAddress ?? context.to],
  };

  return {
    name,
    description: definition.description,
    envelope,
    raw: Buffer.from(raw, 'utf-8'),
    headers: {
      from: context.from,
      to: context.aliasAddress ?? context.to,
      subject: context.subject,
      messageId: context.messageId,
      date: context.date,
    },
  };
}

function subjectForFixture(name: EmailFixtureName): string {
  switch (name) {
    case 'plaintext':
      return 'VaultSandbox plaintext delivery test';
    case 'htmlWithAttachment':
      return 'VaultSandbox HTML + attachment delivery test';
    case 'aliasRecipient':
      return 'VaultSandbox alias delivery test';
    case 'oversized':
      return 'VaultSandbox oversized email test';
    case 'htmlWithUrls':
      return 'VaultSandbox URL extraction test';
    default:
      return 'VaultSandbox email fixture';
  }
}

function buildMessageId(name: string): string {
  const randomSuffix = randomBytes(4).toString('hex');
  return `<${name}-${Date.now().toString(36)}-${randomSuffix}@vaultsandbox.test>`;
}

function buildAliasAddress(baseAddress: string, aliasTag: string): string {
  const [local, domain] = baseAddress.split('@');
  if (!local || !domain) {
    return baseAddress;
  }
  return `${local}+${aliasTag}@${domain}`;
}

function extractEnvelopeAddress(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  if (match) {
    return match[1].trim();
  }
  return fromHeader.trim();
}
