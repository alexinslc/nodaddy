import * as p from '@clack/prompts';
import chalk from 'chalk';
import { getConfig, setConfig } from '../services/state-manager.js';

export interface WizardCredentials {
  godaddy: { apiKey: string; apiSecret: string };
  cloudflare: { apiToken: string; accountId: string };
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
  const hasCloudflare =
    config.cloudflare?.apiToken && config.cloudflare?.accountId;

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
    return {
      godaddy: config.godaddy!,
      cloudflare: config.cloudflare!,
    };
  }

  p.note(
    'Get your GoDaddy API key at https://developer.godaddy.com/keys\n' +
      'Get your Cloudflare API token at https://dash.cloudflare.com/profile/api-tokens',
    'API Credentials Required',
  );

  const credentials = await p.group(
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
      cfToken: () =>
        p.password({
          message: 'Cloudflare API Token',
          validate: (v) => {
            if (!v?.trim()) return 'API token is required';
          },
        }),
      cfAccountId: () =>
        p.text({
          message: 'Cloudflare Account ID',
          placeholder: 'Found on any zone overview page',
          validate: (v) => {
            if (!v?.trim()) return 'Account ID is required';
          },
        }),
      save: () =>
        p.confirm({
          message: 'Save credentials for future use?',
          initialValue: true,
        }),
    },
    {
      onCancel: () => {
        p.cancel('Migration cancelled.');
        process.exit(0);
      },
    },
  );

  const result: WizardCredentials = {
    godaddy: {
      apiKey: credentials.gdKey as string,
      apiSecret: credentials.gdSecret as string,
    },
    cloudflare: {
      apiToken: credentials.cfToken as string,
      accountId: credentials.cfAccountId as string,
    },
  };

  if (credentials.save) {
    setConfig({
      godaddy: result.godaddy,
      cloudflare: result.cloudflare,
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
