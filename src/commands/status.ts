import * as p from '@clack/prompts';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getAllMigrations } from '../services/state-manager.js';
import type { DomainStatus } from '../types/config.js';

const STATUS_COLORS: Record<DomainStatus, (s: string) => string> = {
  pending: chalk.dim,
  dns_migrated: chalk.blue,
  unlocked: chalk.blue,
  auth_obtained: chalk.blue,
  ns_changed: chalk.cyan,
  transfer_initiated: chalk.yellow,
  completed: chalk.green,
  failed: chalk.red,
};

const STATUS_LABELS: Record<DomainStatus, string> = {
  pending: 'Pending',
  dns_migrated: 'DNS Migrated',
  unlocked: 'Unlocked',
  auth_obtained: 'Auth Obtained',
  ns_changed: 'NS Changed',
  transfer_initiated: 'Transferring (1-5 days)',
  completed: 'Completed',
  failed: 'Failed',
};

// Only show migrations where at least one domain reached transfer or completion
const MEANINGFUL_STATUSES = new Set<DomainStatus>([
  'transfer_initiated',
  'completed',
]);

export async function statusCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black(' nodaddy — migration status '));

  const allMigrations = getAllMigrations();
  if (allMigrations.length === 0) {
    p.log.info('No migrations found. Run `nodaddy migrate` to start one.');
    p.outro('');
    return;
  }

  // Filter to migrations that actually transferred something
  const meaningful = allMigrations.filter((m) =>
    Object.values(m.domains).some((d) => MEANINGFUL_STATUSES.has(d.status)),
  );

  if (meaningful.length === 0) {
    p.log.info('No completed transfers yet. Run `nodaddy migrate` to start one.');
    p.outro('');
    return;
  }

  // Collect all domains across migrations into a single deduplicated view.
  // If a domain appears in multiple migrations, show the most recent one.
  const domainMap = new Map<string, { domain: string; status: DomainStatus; error?: string; lastUpdated: string }>();

  // Process oldest first so newer entries overwrite older ones
  for (const migration of [...meaningful].reverse()) {
    for (const d of Object.values(migration.domains)) {
      if (MEANINGFUL_STATUSES.has(d.status)) {
        domainMap.set(d.domain, d);
      }
    }
  }

  const domains = [...domainMap.values()].sort((a, b) =>
    new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime(),
  );

  const table = new Table({
    head: ['Domain', 'Status', 'Last Updated'],
    style: { head: ['cyan'] },
  });

  for (const d of domains) {
    const colorFn = STATUS_COLORS[d.status] ?? chalk.dim;
    const label = STATUS_LABELS[d.status] ?? d.status;
    const updated = new Date(d.lastUpdated).toLocaleString();
    const statusText = d.error
      ? `${colorFn(label)} — ${chalk.red(d.error.slice(0, 60))}`
      : colorFn(label);

    table.push([d.domain, statusText, updated]);
  }

  console.log(table.toString());

  // Summary
  const counts = domains.reduce(
    (acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const summary = Object.entries(counts)
    .map(([status, count]) => {
      const colorFn = STATUS_COLORS[status as DomainStatus] ?? chalk.dim;
      return colorFn(`${STATUS_LABELS[status as DomainStatus] ?? status}: ${count}`);
    })
    .join(' | ');

  p.outro(`${domains.length} domain${domains.length === 1 ? '' : 's'} — ${summary}`);
}
