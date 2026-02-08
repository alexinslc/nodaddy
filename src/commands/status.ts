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
  transfer_initiated: 'Transfer Initiated',
  completed: 'Completed',
  failed: 'Failed',
};

export async function statusCommand(): Promise<void> {
  p.intro(chalk.bgCyan.black(' nodaddy — migration status '));

  const allMigrations = getAllMigrations();
  if (allMigrations.length === 0) {
    p.log.info('No migrations found. Run `nodaddy migrate` to start one.');
    p.outro('');
    return;
  }

  // Show all migrations, newest first
  for (const migration of allMigrations) {
    showMigrationStatus(migration.id, migration);
  }

  p.outro('');
}

function showMigrationStatus(
  id: string,
  migration: { startedAt: string; domains: Record<string, { domain: string; status: DomainStatus; error?: string; lastUpdated: string }> },
): void {
  const domains = Object.values(migration.domains);
  const started = new Date(migration.startedAt).toLocaleString();

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

  p.log.info(`Migration ${chalk.dim(id.slice(0, 8))} — ${started} — ${summary}`);

  const table = new Table({
    head: ['Domain', 'Status', 'Last Updated'],
    style: { head: ['cyan'] },
  });

  for (const d of domains) {
    const colorFn = STATUS_COLORS[d.status] ?? chalk.dim;
    const label = STATUS_LABELS[d.status] ?? d.status;
    const updated = new Date(d.lastUpdated).toLocaleString();
    const statusText = d.error
      ? `${colorFn(label)} — ${chalk.red(d.error.slice(0, 50))}`
      : colorFn(label);

    table.push([d.domain, statusText, updated]);
  }

  console.log(table.toString());
}
