import * as p from '@clack/prompts';
import chalk from 'chalk';
import type { GoDaddyDomain } from '../types/godaddy.js';

export async function selectDomains(
  domains: GoDaddyDomain[],
  selectAll: boolean,
): Promise<string[]> {
  if (selectAll) {
    return domains.map((d) => d.domain);
  }

  // Ask whether to select all or pick individually
  const mode = await p.select({
    message: `${domains.length} domains available — migrate all or choose?`,
    options: [
      { value: 'all', label: 'All domains' },
      { value: 'pick', label: 'Let me choose' },
    ],
  });

  if (p.isCancel(mode)) {
    p.cancel('Migration cancelled.');
    process.exit(0);
  }

  if (mode === 'all') {
    return domains.map((d) => d.domain);
  }

  const options = domains.map((d) => {
    const expires = d.expires
      ? new Date(d.expires).toLocaleDateString()
      : 'unknown';
    const locked = d.locked ? 'locked' : 'unlocked';
    const privacy = d.privacy ? 'privacy' : 'no privacy';

    // Warn if expires within 30 days
    let expiryWarning = '';
    if (d.expires) {
      const daysUntilExpiry =
        (new Date(d.expires).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntilExpiry < 30) {
        expiryWarning = chalk.yellow(' ⚠ expires soon');
      }
    }

    return {
      value: d.domain,
      label: d.domain,
      hint: `expires ${expires}, ${locked}, ${privacy}${expiryWarning}`,
    };
  });

  const selected = await p.multiselect({
    message: `Select domains to migrate (${domains.length} available)`,
    options,
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Migration cancelled.');
    process.exit(0);
  }

  return selected as string[];
}
