import * as p from '@clack/prompts';
import chalk from 'chalk';
import type { GoDaddyClient } from '../providers/godaddy.js';
import type { GoDaddyDnsRecord } from '../types/godaddy.js';
import type { CloudflareDnsRecord } from '../types/cloudflare.js';
import { mapGoDaddyToCloudflare } from '../services/dns-migrator.js';

interface DomainDnsPreview {
  domain: string;
  records: Omit<CloudflareDnsRecord, 'id'>[];
}

function summarizeRecords(records: Omit<CloudflareDnsRecord, 'id'>[]): string {
  const counts = new Map<string, number>();
  for (const r of records) {
    counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  }

  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${count} ${type}`);

  return `${parts.join(', ')} ${chalk.dim(`(${records.length} total)`)}`;
}

function formatRecordDetail(record: Omit<CloudflareDnsRecord, 'id'>): string {
  const type = chalk.cyan(record.type.padEnd(6));
  const name = chalk.bold(record.name);
  const content = record.content.length > 60
    ? record.content.slice(0, 57) + '...'
    : record.content;
  const priority = record.priority !== undefined ? ` (pri: ${record.priority})` : '';

  return `  ${type} ${name} → ${content}${priority}`;
}

export async function previewDnsRecords(
  godaddy: GoDaddyClient,
  domains: string[],
): Promise<void> {
  const s = p.spinner();
  s.start(`Fetching DNS records for ${domains.length} domain${domains.length === 1 ? '' : 's'}...`);

  const previews: DomainDnsPreview[] = [];
  const errors: Array<{ domain: string; error: string }> = [];

  for (const domain of domains) {
    try {
      const gdRecords: GoDaddyDnsRecord[] = await godaddy.getDnsRecords(domain);
      const cfRecords = mapGoDaddyToCloudflare(gdRecords, domain);
      previews.push({ domain, records: cfRecords });
    } catch (err) {
      errors.push({ domain, error: err instanceof Error ? err.message : String(err) });
    }
  }

  s.stop('DNS records fetched');

  // Show summary for each domain
  p.log.message(chalk.bold('DNS records to migrate:'));
  for (const { domain, records } of previews) {
    if (records.length === 0) {
      p.log.message(`  ${chalk.bold(domain)} → ${chalk.dim('no records to migrate')}`);
    } else {
      p.log.message(`  ${chalk.bold(domain)} → ${summarizeRecords(records)}`);
    }
  }

  for (const { domain, error } of errors) {
    p.log.message(`  ${chalk.bold(domain)} → ${chalk.red(`failed: ${error}`)}`);
  }

  // Offer to drill into details if there are records to show
  const domainsWithRecords = previews.filter((p) => p.records.length > 0);
  if (domainsWithRecords.length === 0) return;

  let viewMore = true;
  while (viewMore) {
    const choice = await p.select({
      message: 'View detailed records for a domain?',
      options: [
        { value: '__skip__', label: 'Continue', hint: 'proceed to migration options' },
        ...domainsWithRecords.map((d) => ({
          value: d.domain,
          label: d.domain,
          hint: `${d.records.length} records`,
        })),
      ],
    });

    if (p.isCancel(choice) || choice === '__skip__') {
      viewMore = false;
      break;
    }

    const preview = domainsWithRecords.find((d) => d.domain === choice);
    if (preview) {
      p.log.message(chalk.bold(`\n${preview.domain} records:`));
      for (const record of preview.records) {
        p.log.message(formatRecordDetail(record));
      }
      p.log.message('');
    }
  }
}
