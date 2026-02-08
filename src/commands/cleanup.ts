import * as p from '@clack/prompts';
import chalk from 'chalk';
import {
  getConfig,
  getAllMigrations,
  clearAll,
  getStorePath,
} from '../services/state-manager.js';

export async function cleanupCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black(' nodaddy — cleanup '));

  const config = getConfig();
  const migrations = getAllMigrations();
  const storePath = getStorePath();

  // Show what's stored
  const items: string[] = [];

  if (config.godaddy?.apiKey) {
    items.push('GoDaddy API credentials');
  }
  if (config.cloudflare?.accountId) {
    items.push('Cloudflare API credentials');
  }
  if (config.registrantContact) {
    const c = config.registrantContact;
    items.push(`Registrant contact (${c.first_name} ${c.last_name}, ${c.email})`);
  }
  if (migrations.length > 0) {
    const domainCount = migrations.reduce(
      (sum, m) => sum + Object.keys(m.domains).length,
      0,
    );
    items.push(`${migrations.length} migration${migrations.length === 1 ? '' : 's'} (${domainCount} domain${domainCount === 1 ? '' : 's'})`);
  }

  if (items.length === 0) {
    p.log.info('Nothing stored. Already clean!');
    p.outro('');
    return;
  }

  p.log.info(`Config file: ${chalk.dim(storePath)}`);
  p.log.message('');
  p.log.warn('This will permanently delete:');
  for (const item of items) {
    p.log.message(`  ${chalk.red('•')} ${item}`);
  }

  const confirmed = await p.confirm({
    message: 'Delete all stored data?',
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.outro('Nothing deleted.');
    return;
  }

  clearAll();

  p.log.success('All stored data has been deleted.');
  p.outro(chalk.green('Clean!'));
}
