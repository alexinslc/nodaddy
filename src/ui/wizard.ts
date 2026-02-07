import * as p from '@clack/prompts';
import chalk from 'chalk';
import { getConfig, setConfig } from '../services/state-manager.js';

import type { CloudflareCredentials } from '../types/cloudflare.js';

export interface WizardCredentials {
  godaddy: { apiKey: string; apiSecret: string };
  cloudflare: CloudflareCredentials;
}

export interface MigrationWizardOptions {
  migrateRecords: boolean;
  dryRun: boolean;
  proxied: boolean;
}

export async function collectCredentials(): Promise<WizardCredentials> {
  const config = getConfig();

  // Check for existing stored credentials
  const hasGoDaddy = config.godaddy?.apiKey && config.godaddy?.apiSecret;
  const hasCloudflare = config.cloudflare?.accountId &&
    (config.cloudflare?.apiToken || config.cloudflare?.apiKey);

  let useStored = false;
  if (hasGoDaddy && hasCloudflare) {
    useStored = (await p.confirm({
      message: 'Use stored API credentials?',
      initialValue: true,
    })) as boolean;

    if (p.isCancel(useStored)) {
      p.cancel('Migration cancelled.');
      process.exit(0);
    }
  }

  if (useStored && hasGoDaddy && hasCloudflare) {
    const cf = config.cloudflare!;
    const cloudflare: CloudflareCredentials = cf.authType === 'global-key'
      ? { authType: 'global-key', apiKey: cf.apiKey!, email: cf.email!, accountId: cf.accountId }
      : { authType: 'token', apiToken: cf.apiToken!, accountId: cf.accountId };
    return {
      godaddy: config.godaddy!,
      cloudflare,
    };
  }

  p.note(
    'Get your GoDaddy API key at https://developer.godaddy.com/keys\n' +
      'Get your Cloudflare credentials at https://dash.cloudflare.com/profile/api-tokens',
    'API Credentials Required',
  );

  // GoDaddy credentials
  const gdCreds = await p.group(
    {
      gdKey: () =>
        p.text({
          message: 'GoDaddy API Key',
          placeholder: 'e.g. dLf3...',
          validate: (v) => {
            if (!v?.trim()) return 'API key is required';
          },
        }),
      gdSecret: () =>
        p.password({
          message: 'GoDaddy API Secret',
          validate: (v) => {
            if (!v?.trim()) return 'API secret is required';
          },
        }),
    },
    { onCancel: () => { p.cancel('Migration cancelled.'); process.exit(0); } },
  );

  // Cloudflare auth type
  const cfAuthType = await p.select({
    message: 'Cloudflare auth method',
    options: [
      { value: 'global-key', label: 'Global API Key', hint: 'recommended — supports registrar transfers' },
      { value: 'token', label: 'Scoped API Token', hint: 'limited — no registrar transfer support' },
    ],
  });

  if (p.isCancel(cfAuthType)) {
    p.cancel('Migration cancelled.');
    process.exit(0);
  }

  let cloudflare: CloudflareCredentials;

  if (cfAuthType === 'global-key') {
    const cfCreds = await p.group(
      {
        email: () =>
          p.text({
            message: 'Cloudflare account email',
            placeholder: 'you@example.com',
            validate: (v) => {
              if (!v?.trim()) return 'Email is required';
            },
          }),
        apiKey: () =>
          p.password({
            message: 'Cloudflare Global API Key',
            validate: (v) => {
              if (!v?.trim()) return 'API key is required';
            },
          }),
        accountId: () =>
          p.text({
            message: 'Cloudflare Account ID',
            placeholder: 'Found on any zone overview page',
            validate: (v) => {
              if (!v?.trim()) return 'Account ID is required';
            },
          }),
      },
      { onCancel: () => { p.cancel('Migration cancelled.'); process.exit(0); } },
    );
    cloudflare = {
      authType: 'global-key',
      apiKey: cfCreds.apiKey as string,
      email: cfCreds.email as string,
      accountId: cfCreds.accountId as string,
    };
  } else {
    const cfCreds = await p.group(
      {
        apiToken: () =>
          p.password({
            message: 'Cloudflare API Token',
            validate: (v) => {
              if (!v?.trim()) return 'API token is required';
            },
          }),
        accountId: () =>
          p.text({
            message: 'Cloudflare Account ID',
            placeholder: 'Found on any zone overview page',
            validate: (v) => {
              if (!v?.trim()) return 'Account ID is required';
            },
          }),
      },
      { onCancel: () => { p.cancel('Migration cancelled.'); process.exit(0); } },
    );
    cloudflare = {
      authType: 'token',
      apiToken: cfCreds.apiToken as string,
      accountId: cfCreds.accountId as string,
    };
  }

  const save = await p.confirm({
    message: 'Save credentials for future use?',
    initialValue: true,
  });

  if (p.isCancel(save)) {
    p.cancel('Migration cancelled.');
    process.exit(0);
  }

  const result: WizardCredentials = {
    godaddy: {
      apiKey: gdCreds.gdKey as string,
      apiSecret: gdCreds.gdSecret as string,
    },
    cloudflare,
  };

  if (save) {
    setConfig({
      godaddy: result.godaddy,
      cloudflare: cloudflare.authType === 'global-key'
        ? { authType: 'global-key', apiKey: cloudflare.apiKey, email: cloudflare.email, accountId: cloudflare.accountId }
        : { authType: 'token', apiToken: cloudflare.apiToken, accountId: cloudflare.accountId },
    });
    p.log.success('Credentials saved.');
  }

  return result;
}

export async function collectMigrationOptions(): Promise<MigrationWizardOptions> {
  const options = await p.group(
    {
      migrateRecords: () =>
        p.confirm({
          message: 'Migrate DNS records to Cloudflare?',
          initialValue: true,
        }),
      proxied: () =>
        p.confirm({
          message: 'Proxy records through Cloudflare (orange cloud)?',
          initialValue: false,
        }),
      dryRun: () =>
        p.confirm({
          message: 'Dry run first? (preview without making changes)',
          initialValue: false,
        }),
    },
    {
      onCancel: () => {
        p.cancel('Migration cancelled.');
        process.exit(0);
      },
    },
  );

  return {
    migrateRecords: options.migrateRecords as boolean,
    proxied: options.proxied as boolean,
    dryRun: options.dryRun as boolean,
  };
}

export async function confirmMigration(
  domainCount: number,
  dryRun: boolean,
): Promise<boolean> {
  const action = dryRun ? 'preview migration for' : 'migrate';
  const confirmed = await p.confirm({
    message: `Proceed to ${action} ${chalk.bold(domainCount)} domain${domainCount === 1 ? '' : 's'}?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed)) {
    p.cancel('Migration cancelled.');
    process.exit(0);
  }

  return confirmed as boolean;
}
