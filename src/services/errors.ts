import chalk from 'chalk';

interface ErrorHint {
  match: (message: string, statusCode?: number) => boolean;
  suggestion: string;
}

const GODADDY_HINTS: ErrorHint[] = [
  {
    match: (_, status) => status === 401 || status === 403,
    suggestion:
      'Check your GoDaddy API key and secret at https://developer.godaddy.com/keys',
  },
  {
    match: (_, status) => status === 429,
    suggestion:
      'GoDaddy rate limit hit. Wait a minute and try again, or reduce concurrency.',
  },
  {
    match: (msg) => msg.includes('DOMAIN_LOCKED'),
    suggestion:
      'Domain is locked. It may take a few minutes after unlocking before GoDaddy reflects the change.',
  },
  {
    match: (msg) => msg.includes('409') || msg.includes('Conflict'),
    suggestion:
      'The auth code may have been sent to your email instead. Check your inbox and use `nodaddy resume` to continue.',
  },
  {
    match: (msg) =>
      msg.includes('UNABLE_TO_AUTHENTICATE') || msg.includes('NOT_FOUND'),
    suggestion:
      'Make sure you are using a Production API key (not OTE/Test) at https://developer.godaddy.com/keys',
  },
];

const CLOUDFLARE_HINTS: ErrorHint[] = [
  {
    match: (_, status) => status === 401 || status === 403,
    suggestion:
      'Check your Cloudflare API token permissions. Required: Zone:Edit, DNS:Edit, Registrar Domains:Edit',
  },
  {
    match: (msg) => msg.includes('already exists'),
    suggestion:
      'This zone already exists in Cloudflare. You may need to delete it first or use the existing zone.',
  },
  {
    match: (_, status) => status === 429,
    suggestion:
      'Cloudflare rate limit hit. The tool will automatically retry with backoff.',
  },
  {
    match: (msg) => msg.includes('not_registrable'),
    suggestion:
      'This TLD cannot be transferred to Cloudflare Registrar. DNS-only setup is still possible.',
  },
  {
    match: (msg) => msg.includes('did not become active'),
    suggestion:
      'Nameserver changes can take up to 48 hours to propagate. Run `nodaddy resume` to retry later.',
  },
];

export function formatError(
  err: unknown,
  provider?: 'godaddy' | 'cloudflare',
  plain = false,
): string {
  const message = err instanceof Error ? err.message : String(err);
  const statusCode = (err as { statusCode?: number }).statusCode;

  const hints = provider === 'godaddy'
    ? GODADDY_HINTS
    : provider === 'cloudflare'
      ? CLOUDFLARE_HINTS
      : [...GODADDY_HINTS, ...CLOUDFLARE_HINTS];

  const hint = hints.find((h) => h.match(message, statusCode));

  if (hint) {
    return plain
      ? `${message} | Suggestion: ${hint.suggestion}`
      : `${message}\n  ${chalk.yellow('Suggestion:')} ${hint.suggestion}`;
  }

  return message;
}
