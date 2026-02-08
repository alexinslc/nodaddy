import * as p from '@clack/prompts';
import chalk from 'chalk';
import { GoDaddyClient } from '../providers/godaddy.js';
import { CloudflareClient } from '../providers/cloudflare.js';
import {
  getActiveMigration,
  getAllMigrations,
  getResumableDomains,
  getConfig,
} from '../services/state-manager.js';
import { collectRegistrantContact } from '../ui/wizard.js';
import { createMigrationTasks, type MigrationContext } from '../ui/progress.js';

export async function resumeCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black(' nodaddy — resume migration '));

  const migration = getActiveMigration();

  if (!migration) {
    const allMigrations = getAllMigrations();
    if (allMigrations.length === 0) {
      p.log.info('No migrations found. Run `nodaddy migrate` to start one.');
      p.outro('');
      return;
    }
    p.log.warn('No active migration. Use `nodaddy status` to review past migrations.');
    p.outro('');
    return;
  }

  const resumable = getResumableDomains(migration.id);
  const allDomains = Object.values(migration.domains);
  const completed = allDomains.filter(
    (d) => d.status === 'completed' || d.status === 'transfer_initiated',
  );

  p.log.info(
    `Migration ${chalk.dim(migration.id.slice(0, 8))}: ${completed.length}/${allDomains.length} done, ${resumable.length} remaining`,
  );

  if (resumable.length === 0) {
    p.log.success('All domains have been processed!');
    p.outro('');
    return;
  }

  // Show what will be resumed
  for (const d of resumable) {
    const statusLabel = d.status === 'failed'
      ? chalk.red(`failed: ${d.error?.slice(0, 60)}`)
      : chalk.yellow(d.status);
    p.log.message(`  ${d.domain} — ${statusLabel}`);
  }

  const confirmed = await p.confirm({
    message: `Resume migration for ${chalk.bold(resumable.length)} domain${resumable.length === 1 ? '' : 's'}?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.outro('Cancelled.');
    return;
  }

  // Load and validate credentials
  const config = getConfig();
  const gd = config.godaddy;
  const cf = config.cloudflare;

  if (!gd?.apiKey || !gd?.apiSecret) {
    p.log.error('GoDaddy credentials not found. Run `nodaddy migrate` to set them up.');
    process.exit(1);
  }

  if (!cf?.accountId) {
    p.log.error('Cloudflare credentials not found. Run `nodaddy migrate` to set them up.');
    process.exit(1);
  }

  if (cf.authType === 'global-key' && (!cf.apiKey || !cf.email)) {
    p.log.error('Cloudflare Global API Key credentials incomplete. Run `nodaddy migrate` to reconfigure.');
    process.exit(1);
  }

  if (cf.authType === 'token' && !cf.apiToken) {
    p.log.error('Cloudflare API Token not found. Run `nodaddy migrate` to reconfigure.');
    process.exit(1);
  }

  const cfCreds = cf.authType === 'global-key'
    ? { authType: 'global-key' as const, apiKey: cf.apiKey!, email: cf.email!, accountId: cf.accountId }
    : { authType: 'token' as const, apiToken: cf.apiToken!, accountId: cf.accountId };

  const godaddy = new GoDaddyClient(gd);
  const cloudflare = new CloudflareClient(cfCreds);

  // Collect registrant contact — required by ICANN for transfer completion
  // Scoped tokens can't do registrar transfers, so skip contact collection
  let contact;
  if (cf.authType === 'global-key') {
    contact = await collectRegistrantContact();
  } else {
    p.log.warn(
      'Scoped API tokens do not support registrar transfers. DNS will be migrated but domains will not be transferred.',
    );
    contact = undefined;
  }

  const domainNames = resumable.map((d) => d.domain);
  const tasks = createMigrationTasks(
    domainNames,
    godaddy,
    cloudflare,
    migration.id,
    { dryRun: false, migrateRecords: true, proxied: false },
    contact,
  );

  const ctx: MigrationContext = { results: new Map() };
  try {
    await tasks.run(ctx);
  } catch {
    // Errors handled per-task
  }

  const succeeded = domainNames.filter((d) => ctx.results.get(d)?.success);
  const failed = domainNames.filter((d) => !ctx.results.get(d)?.success);

  if (failed.length === 0) {
    p.log.success('All domains resumed successfully.');
  } else if (succeeded.length > 0) {
    p.log.warn(
      `${chalk.green(succeeded.length)} succeeded, ${chalk.red(failed.length)} still failing`,
    );
  } else {
    p.log.error(`All ${domainNames.length} domain${domainNames.length === 1 ? '' : 's'} failed again`);
  }

  if (failed.length > 0) {
    p.note(
      `${failed.length} domain${failed.length === 1 ? '' : 's'} still failing. Progress is saved.\n\n` +
        `You can run ${chalk.cyan('nodaddy resume')} again after fixing the issue.\n\n` +
        `Common fixes:\n` +
        `  • "Resource is being used" — wait a few minutes and retry\n` +
        `  • Domain Protection — disable at https://dcc.godaddy.com\n` +
        `  • Auth code issues — check your GoDaddy email inbox`,
      'Still Failing',
    );
  } else {
    p.note(
      `Track transfer progress:\n` +
        `  ${chalk.cyan('nodaddy status')}\n\n` +
        `  https://dash.cloudflare.com/?to=/:account/domains/transfer`,
      'Next Steps',
    );
  }

  p.outro(chalk.green('Done!'));
}
