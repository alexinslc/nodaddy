import * as p from '@clack/prompts';
import chalk from 'chalk';
import Table from 'cli-table3';
import { GoDaddyClient } from '../providers/godaddy.js';
import { getConfig } from '../services/state-manager.js';

export async function listCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black(' nodaddy — list domains '));

  const gdKey = process.env.GODADDY_API_KEY;
  const gdSecret = process.env.GODADDY_API_SECRET;
  const config = getConfig();

  const apiKey = gdKey || config.godaddy?.apiKey;
  const apiSecret = gdSecret || config.godaddy?.apiSecret;

  if (!apiKey || !apiSecret) {
    p.log.error(
      'GoDaddy credentials not configured. Set GODADDY_API_KEY/GODADDY_API_SECRET env vars, or run `nodaddy migrate`.',
    );
    process.exit(1);
  }

  const godaddy = new GoDaddyClient({ apiKey, apiSecret });

  const s = p.spinner();
  s.start('Fetching domains from GoDaddy...');

  try {
    const domains = await godaddy.listDomains();
    s.stop(`Found ${chalk.bold(domains.length)} active domains`);

    if (domains.length === 0) {
      p.log.info('No active domains found.');
      p.outro('');
      return;
    }

    const table = new Table({
      head: ['Domain', 'Expires', 'Locked', 'Privacy', 'Auto-Renew'],
      style: { head: ['cyan'] },
    });

    for (const d of domains) {
      const expires = d.expires
        ? new Date(d.expires).toLocaleDateString()
        : '—';
      const locked = d.locked ? chalk.yellow('Yes') : chalk.green('No');
      const privacy = d.privacy ? chalk.yellow('Yes') : chalk.dim('No');
      const autoRenew = d.renewAuto
        ? chalk.yellow('Yes')
        : chalk.dim('No');

      table.push([d.domain, expires, locked, privacy, autoRenew]);
    }

    console.log(table.toString());
    p.outro(`${domains.length} domains total`);
  } catch (err) {
    s.stop('Failed to fetch domains');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
