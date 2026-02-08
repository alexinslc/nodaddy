import * as p from '@clack/prompts';
import chalk from 'chalk';
import { GoDaddyClient } from '../providers/godaddy.js';
import { CloudflareClient } from '../providers/cloudflare.js';
import {
  collectCredentials,
  collectMigrationOptions,
  collectRegistrantContact,
  confirmTransferCost,
  confirmMigration,
} from '../ui/wizard.js';
import { selectDomains } from '../ui/domain-selector.js';
import { previewDnsRecords } from '../ui/dns-preview.js';
import { preflightCheck, type PreflightResult } from '../services/transfer-engine.js';
import { createMigrationTasks, type MigrationContext } from '../ui/progress.js';
import { createMigration } from '../services/state-manager.js';
import type { GoDaddyDomain } from '../types/godaddy.js';

interface MigrateOptions {
  all?: boolean;
  dryRun?: boolean;
}

export async function migrateCommand(opts: MigrateOptions): Promise<void> {
  p.intro(chalk.bgCyan.black(' nodaddy '));

  // Step 1: Collect credentials
  const creds = await collectCredentials();

  // Step 2: Verify API access
  const s = p.spinner();
  s.start('Verifying API credentials...');

  const godaddy = new GoDaddyClient(creds.godaddy);
  const cloudflare = new CloudflareClient(creds.cloudflare);

  const [gdValid, cfValid] = await Promise.all([
    godaddy.verifyCredentials(),
    cloudflare.verifyCredentials(),
  ]);

  if (!gdValid) {
    s.stop('GoDaddy credentials invalid');
    p.log.error('Failed to authenticate with GoDaddy API. Check your API key and secret.');
    process.exit(1);
  }
  if (!cfValid) {
    s.stop('Cloudflare credentials invalid');
    p.log.error('Failed to authenticate with Cloudflare API. Check your API token.');
    process.exit(1);
  }
  s.stop('API credentials verified');

  // Step 3: List domains
  s.start('Fetching domains from GoDaddy...');
  let domains: GoDaddyDomain[];
  try {
    domains = await godaddy.listDomains();
  } catch (err) {
    s.stop('Failed to fetch domains');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  s.stop(`Found ${chalk.bold(domains.length)} active domains`);

  if (domains.length === 0) {
    p.log.warn('No active domains found in your GoDaddy account.');
    p.outro('Nothing to migrate.');
    return;
  }

  // Step 4: Select domains
  const selected = await selectDomains(domains, opts.all ?? false);
  if (selected.length === 0) {
    p.outro('No domains selected.');
    return;
  }

  // Step 5: Preflight checks (fetch full details to detect Domain Protection)
  s.start('Running preflight checks...');
  const selectedDomainDetails = await Promise.all(
    selected.map((d) => godaddy.getDomainDetail(d)),
  );
  const preflightResults: PreflightResult[] =
    selectedDomainDetails.map(preflightCheck);

  const eligible = preflightResults.filter((r) => r.eligible);
  const ineligible = preflightResults.filter((r) => !r.eligible);
  s.stop(
    `${chalk.green(eligible.length)} eligible, ${chalk.red(ineligible.length)} ineligible`,
  );

  if (ineligible.length > 0) {
    p.log.warn('Ineligible domains:');
    for (const result of ineligible) {
      p.log.message(
        `  ${chalk.red('✗')} ${result.domain}: ${result.reasons.join(', ')}`,
      );
    }
  }

  if (eligible.length === 0) {
    p.outro('No eligible domains to migrate.');
    return;
  }

  // Step 6: DNS preview
  const eligibleDomains = eligible.map((r) => r.domain);
  await previewDnsRecords(godaddy, eligibleDomains);

  // Step 7: Migration options
  const migrationOptions = await collectMigrationOptions(
    opts.dryRun ? { dryRun: true } : undefined,
  );

  // Step 8: Transfer cost acknowledgment (before collecting personal info)
  const canTransfer = creds.cloudflare.authType === 'global-key';
  if (!migrationOptions.dryRun && canTransfer) {
    const costConfirmed = await confirmTransferCost(eligible.length);
    if (!costConfirmed) {
      p.outro('Migration cancelled.');
      return;
    }
  }

  // Step 9: Registrant contact (only for real transfers with Global API Key)
  let contact;
  if (migrationOptions.dryRun) {
    contact = undefined;
  } else if (canTransfer) {
    contact = await collectRegistrantContact();
  } else {
    p.log.warn(
      'Scoped API tokens do not support registrar transfers. DNS will be migrated but domains will not be transferred.',
    );
    contact = undefined;
  }

  // Step 10: Final confirm
  const confirmed = await confirmMigration(
    eligible.length,
    migrationOptions.dryRun,
  );
  if (!confirmed) {
    p.outro('Migration cancelled.');
    return;
  }

  // Step 10: Execute migration
  const migration = createMigration(eligibleDomains);

  p.log.step(
    migrationOptions.dryRun
      ? 'Starting dry run...'
      : 'Starting migration...',
  );

  const tasks = createMigrationTasks(
    eligibleDomains,
    godaddy,
    cloudflare,
    migration.id,
    migrationOptions,
    contact,
  );

  const ctx: MigrationContext = { results: new Map() };
  try {
    await tasks.run(ctx);
  } catch {
    // Errors are handled per-task via exitOnError: false
  }

  // Step 11: Summary
  const succeeded = eligibleDomains.filter(
    (d) => ctx.results.get(d)?.success,
  );
  const failed = eligibleDomains.filter(
    (d) => !ctx.results.get(d)?.success,
  );

  if (migrationOptions.dryRun) {
    p.log.success(`Preview run finished for ${succeeded.length}/${eligible.length} domains`);
  } else if (succeeded.length === eligible.length) {
    p.log.success(`Migration run finished for ${succeeded.length}/${eligible.length} domains`);
  } else if (succeeded.length > 0) {
    p.log.warn(
      `Migration run finished: ${chalk.green(succeeded.length)} succeeded, ${chalk.red(failed.length)} failed`,
    );
  } else {
    p.log.error(
      `Migration failed for all ${eligible.length} domain${eligible.length === 1 ? '' : 's'}`,
    );
  }

  if (!migrationOptions.dryRun && succeeded.length > 0) {
    p.note(
      `Transfers initiated for ${succeeded.length} domain${succeeded.length === 1 ? '' : 's'}.\n\n` +
        `Track progress:\n` +
        `  ${chalk.cyan('nodaddy status')}\n\n` +
        `  https://dash.cloudflare.com/?to=/:account/domains/transfer\n\n` +
        `Transfers typically take 1-5 days to complete.`,
      'Next Steps',
    );
  }

  if (!migrationOptions.dryRun && failed.length > 0) {
    p.note(
      `${failed.length} domain${failed.length === 1 ? '' : 's'} failed. Your progress has been saved.\n\n` +
        `To retry failed domains:\n` +
        `  ${chalk.cyan('nodaddy resume')}\n\n` +
        `To see what went wrong:\n` +
        `  ${chalk.cyan('nodaddy status')}\n\n` +
        `Common fixes:\n` +
        `  • "Resource is being used" — GoDaddy is still processing a\n` +
        `    recent change. Wait a few minutes and run resume.\n` +
        `  • Domain Protection — disable at https://dcc.godaddy.com\n` +
        `  • Auth code issues — check your GoDaddy email inbox`,
      'Failed Domains',
    );
  }

  p.outro(chalk.green('Done!'));
}
