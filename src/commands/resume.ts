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
import { createMigrationTasks } from '../ui/progress.js';

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

  const domainNames = resumable.map((d) => d.domain);
  const tasks = createMigrationTasks(
    domainNames,
    godaddy,
    cloudflare,
    migration.id,
    { dryRun: false, migrateRecords: true, proxied: false },
  );

  try {
    await tasks.run({ results: new Map() });
  } catch {
    // Errors handled per-task
  }

  p.log.success('Resume complete.');
  p.note('Run `nodaddy status` to check results.', 'Next Steps');
  p.outro(chalk.green('Done!'));
}
