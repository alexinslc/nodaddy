import * as p from '@clack/prompts';
import chalk from 'chalk';
import { getConfig, setConfig } from '../services/state-manager.js';

import type { CloudflareCredentials, RegistrantContact } from '../types/cloudflare.js';

export interface WizardCredentials {
  godaddy: { apiKey: string; apiSecret: string };
  cloudflare: CloudflareCredentials;
}

export interface MigrationWizardOptions {
  migrateRecords: boolean;
  dryRun: boolean;
  proxied: boolean;
}

function credentialsFromEnv(): WizardCredentials | null {
  const gdKey = process.env.GODADDY_API_KEY;
  const gdSecret = process.env.GODADDY_API_SECRET;
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!gdKey || !gdSecret || !cfAccountId) return null;

  const cfApiKey = process.env.CLOUDFLARE_API_KEY;
  const cfEmail = process.env.CLOUDFLARE_EMAIL;
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;

  let cloudflare: CloudflareCredentials;
  if (cfApiKey && cfEmail) {
    cloudflare = { authType: 'global-key', apiKey: cfApiKey, email: cfEmail, accountId: cfAccountId };
  } else if (cfToken) {
    cloudflare = { authType: 'token', apiToken: cfToken, accountId: cfAccountId };
  } else {
    return null;
  }

  return {
    godaddy: { apiKey: gdKey, apiSecret: gdSecret },
    cloudflare,
  };
}

export async function collectCredentials(): Promise<WizardCredentials> {
  // Check env vars first
  const envCreds = credentialsFromEnv();
  if (envCreds) {
    p.log.info('Using credentials from environment variables.');
    return envCreds;
  }

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
    'GoDaddy: Create a Production API key (not OTE/Test) at\n' +
      '  https://developer.godaddy.com/keys\n\n' +
      'Cloudflare: Use your Global API Key (bottom of page) at\n' +
      '  https://dash.cloudflare.com/profile/api-tokens\n' +
      '  Account ID is on any zone overview page.',
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

export async function collectMigrationOptions(
  overrides?: { dryRun?: boolean },
): Promise<MigrationWizardOptions> {
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
    },
    {
      onCancel: () => {
        p.cancel('Migration cancelled.');
        process.exit(0);
      },
    },
  );

  let dryRun = overrides?.dryRun ?? false;
  if (!overrides?.dryRun) {
    const answer = await p.confirm({
      message: 'Dry run first? (preview without making changes)',
      initialValue: false,
    });
    if (p.isCancel(answer)) {
      p.cancel('Migration cancelled.');
      process.exit(0);
    }
    dryRun = answer as boolean;
  }

  return {
    migrateRecords: options.migrateRecords as boolean,
    proxied: options.proxied as boolean,
    dryRun,
  };
}

export async function collectRegistrantContact(): Promise<RegistrantContact> {
  p.note(
    'ICANN requires registrant contact info for all domain transfers.\n' +
      'Cloudflare enables free WHOIS privacy by default, so this\n' +
      'information will not be publicly visible after the transfer.',
    'Registrant Contact',
  );

  const contact = await p.group(
    {
      first_name: () =>
        p.text({
          message: 'First name',
          validate: (v) => { if (!v?.trim()) return 'Required'; },
        }),
      last_name: () =>
        p.text({
          message: 'Last name',
          validate: (v) => { if (!v?.trim()) return 'Required'; },
        }),
      email: () =>
        p.text({
          message: 'Email',
          placeholder: 'you@example.com',
          validate: (v) => { if (!v?.trim()) return 'Required'; },
        }),
      phone: () =>
        p.text({
          message: 'Phone',
          placeholder: '+1.5551234567',
          validate: (v) => { if (!v?.trim()) return 'Required'; },
        }),
      address: () =>
        p.text({
          message: 'Street address',
          validate: (v) => { if (!v?.trim()) return 'Required'; },
        }),
      address2: () =>
        p.text({
          message: 'Address line 2 (optional)',
          defaultValue: '',
        }),
      city: () =>
        p.text({
          message: 'City',
          validate: (v) => { if (!v?.trim()) return 'Required'; },
        }),
      state: () =>
        p.text({
          message: 'State / Province',
          validate: (v) => { if (!v?.trim()) return 'Required'; },
        }),
      zip: () =>
        p.text({
          message: 'Postal code',
          validate: (v) => { if (!v?.trim()) return 'Required'; },
        }),
      country: () =>
        p.text({
          message: 'Country code',
          placeholder: 'US',
          validate: (v) => { if (!v?.trim()) return 'Required'; },
        }),
    },
    { onCancel: () => { p.cancel('Migration cancelled.'); process.exit(0); } },
  );

  return {
    first_name: contact.first_name as string,
    last_name: contact.last_name as string,
    organization: '',
    address: contact.address as string,
    address2: (contact.address2 as string) ?? '',
    city: contact.city as string,
    state: contact.state as string,
    zip: contact.zip as string,
    country: contact.country as string,
    phone: contact.phone as string,
    email: contact.email as string,
  };
}

export async function confirmTransferCost(
  domainCount: number,
): Promise<boolean> {
  p.note(
    `Each domain transfer includes a 1-year renewal charged at\n` +
      `Cloudflare's at-cost pricing. Cost varies by TLD — common\n` +
      `examples: .com ~$9.15, .net ~$10.50, .org ~$10.00/year.\n` +
      `Other TLDs may cost more. Check Cloudflare's pricing for details.\n\n` +
      `Payment is billed to the card on file in your Cloudflare account.\n` +
      `Domains to transfer: ${chalk.bold(domainCount)}`,
    'Transfer Cost',
  );

  const confirmed = await p.confirm({
    message: `I understand that ${chalk.bold(domainCount)} domain transfer${domainCount === 1 ? '' : 's'} will be charged to my Cloudflare account`,
    initialValue: true,
  });

  if (p.isCancel(confirmed)) {
    p.cancel('Migration cancelled.');
    process.exit(0);
  }

  return confirmed as boolean;
}

export async function confirmMigration(
  domainCount: number,
  dryRun: boolean,
): Promise<boolean> {
  const action = dryRun ? 'preview migration for' : 'start migration for';
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
