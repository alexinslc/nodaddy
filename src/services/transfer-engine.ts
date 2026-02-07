import type { GoDaddyClient } from '../providers/godaddy.js';
import type { CloudflareClient } from '../providers/cloudflare.js';
import type { GoDaddyDomain } from '../types/godaddy.js';
import type { MigrationOptions, DomainStatus } from '../types/config.js';
import {
  mapGoDaddyToCloudflare,
  migrateDnsRecords,
} from './dns-migrator.js';
import * as state from './state-manager.js';
import { formatError } from './errors.js';

export interface TransferProgress {
  domain: string;
  step: string;
  status: DomainStatus;
  error?: string;
}

export type ProgressCallback = (progress: TransferProgress) => void;

// TLDs that Cloudflare Registrar does NOT support for transfer
const UNSUPPORTED_TLDS = new Set([
  'uk',
  'co.uk',
  'org.uk',
  'me.uk',
  'de',
  'ca',
  'au',
  'com.au',
  'net.au',
  'jp',
  'eu',
  'be',
  'fr',
  'nl',
]);

export interface PreflightResult {
  domain: string;
  eligible: boolean;
  reasons: string[];
}

export function preflightCheck(domain: GoDaddyDomain): PreflightResult {
  const reasons: string[] = [];

  // Check status
  if (domain.status !== 'ACTIVE') {
    reasons.push(`Status is ${domain.status}, must be ACTIVE`);
  }

  // Check domain age (60-day ICANN lock)
  if (domain.createdAt) {
    const created = new Date(domain.createdAt);
    const daysSinceCreation =
      (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation < 60) {
      reasons.push(
        `Domain is only ${Math.floor(daysSinceCreation)} days old (60-day minimum)`,
      );
    }
  }

  // Check TLD support
  const tld = domain.domain.split('.').slice(1).join('.');
  if (UNSUPPORTED_TLDS.has(tld)) {
    reasons.push(`TLD .${tld} is not supported by Cloudflare Registrar`);
  }

  return {
    domain: domain.domain,
    eligible: reasons.length === 0,
    reasons,
  };
}

export async function transferDomain(
  godaddy: GoDaddyClient,
  cloudflare: CloudflareClient,
  domain: string,
  migrationId: string,
  options: MigrationOptions,
  onProgress?: ProgressCallback,
): Promise<void> {
  const report = (step: string, status: DomainStatus, error?: string) => {
    onProgress?.({ domain, step, status, error });
  };

  try {
    // Step 1: Export DNS records from GoDaddy
    report('Exporting DNS records', 'pending');
    const dnsRecords = await godaddy.getDnsRecords(domain);
    state.saveDnsBackup(migrationId, domain, dnsRecords);

    if (options.dryRun) {
      report('Dry run — would migrate DNS records', 'pending');
      return;
    }

    // Step 2: Create Cloudflare zone and migrate DNS
    report('Creating Cloudflare zone', 'pending');
    let zone;
    try {
      zone = await cloudflare.createZone(domain);
    } catch (err) {
      // Zone might already exist — try to find it
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already exists')) {
        // Try fetching existing zone by listing zones
        report('Zone already exists, looking up', 'pending');
        const existingZones = await cloudflare.listDnsRecords(''); // will error, need different approach
        throw err; // For now, re-throw
      }
      throw err;
    }

    const zoneId = zone.id;
    const nameservers = zone.name_servers ?? [];
    state.updateDomainStatus(migrationId, domain, 'pending', {
      cloudflareZoneId: zoneId,
      cloudflareNameservers: nameservers,
    });

    // Step 3: Migrate DNS records
    if (options.migrateRecords) {
      report('Migrating DNS records', 'pending');
      const cfRecords = mapGoDaddyToCloudflare(dnsRecords, domain);
      const result = await migrateDnsRecords(cloudflare, zoneId, cfRecords);
      if (result.failed.length > 0) {
        report(
          `DNS migration: ${result.created} created, ${result.failed.length} failed`,
          'pending',
        );
      }
    }
    state.updateDomainStatus(migrationId, domain, 'dns_migrated');
    report('DNS migrated', 'dns_migrated');

    // Step 4: Prepare GoDaddy domain for transfer
    report('Removing privacy', 'dns_migrated');
    try {
      await godaddy.removePrivacy(domain);
    } catch {
      // Privacy might not be enabled — that's OK
    }

    report('Disabling auto-renew', 'dns_migrated');
    try {
      await godaddy.disableAutoRenew(domain);
    } catch {
      // May not be enabled
    }

    report('Unlocking domain', 'dns_migrated');
    await godaddy.unlockDomain(domain);

    // Verify unlock
    const detail = await godaddy.getDomainDetail(domain);
    if (detail.locked) {
      throw new Error(`Domain ${domain} is still locked after unlock request`);
    }
    state.updateDomainStatus(migrationId, domain, 'unlocked');
    report('Domain unlocked', 'unlocked');

    // Step 5: Get auth code
    report('Fetching auth code', 'unlocked');
    const authCode = await godaddy.getAuthCode(domain);
    state.updateDomainStatus(migrationId, domain, 'auth_obtained', {
      authCode,
    });
    report('Auth code obtained', 'auth_obtained');

    // Step 6: Update nameservers at GoDaddy
    if (nameservers.length > 0) {
      report('Updating nameservers', 'auth_obtained');
      await godaddy.updateNameservers(domain, nameservers);
      state.updateDomainStatus(migrationId, domain, 'ns_changed');
      report('Nameservers updated', 'ns_changed');
    }

    // Step 7: Initiate transfer at Cloudflare
    report('Initiating transfer', 'ns_changed');
    await cloudflare.initiateTransfer(domain, authCode);
    state.updateDomainStatus(migrationId, domain, 'transfer_initiated');
    report('Transfer initiated', 'transfer_initiated');
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    // Detect provider from error type name
    const provider = rawMessage.includes('GoDaddy') ? 'godaddy' as const
      : rawMessage.includes('Cloudflare') ? 'cloudflare' as const
      : undefined;
    const message = formatError(err, provider);
    state.updateDomainStatus(migrationId, domain, 'failed', {
      error: rawMessage,
    });
    report(message, 'failed', message);
    throw err;
  }
}
