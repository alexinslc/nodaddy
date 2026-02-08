import type { GoDaddyClient } from '../providers/godaddy.js';
import type { CloudflareClient } from '../providers/cloudflare.js';
import type { GoDaddyDomain } from '../types/godaddy.js';
import type { MigrationOptions, DomainStatus } from '../types/config.js';
import type { RegistrantContact } from '../types/cloudflare.js';
import {
  mapGoDaddyToCloudflare,
  migrateDnsRecords,
} from './dns-migrator.js';
import * as state from './state-manager.js';
import { formatError } from './errors.js';

export interface TransferResult {
  authCode: string;
}

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
    reasons.push(
      `Status is ${domain.status} — domain must be ACTIVE to transfer. Check your GoDaddy dashboard for holds or suspensions.`,
    );
  }

  // Check domain age (60-day ICANN lock)
  if (domain.createdAt) {
    const created = new Date(domain.createdAt);
    const daysSinceCreation =
      (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation < 60) {
      const daysRemaining = Math.ceil(60 - daysSinceCreation);
      reasons.push(
        `Domain is only ${Math.floor(daysSinceCreation)} days old — ICANN requires 60 days before transfer. Try again in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
      );
    }
  }

  // Check TLD support
  const tld = domain.domain.split('.').slice(1).join('.');
  if (UNSUPPORTED_TLDS.has(tld)) {
    reasons.push(
      `TLD .${tld} is not supported by Cloudflare Registrar — see https://www.cloudflare.com/tld-policies/ for supported TLDs`,
    );
  }

  // Check Domain Protection (cannot be disabled via API — requires dashboard identity verification)
  if (domain.transferProtected) {
    reasons.push(
      'Domain Protection is enabled — disable at https://dcc.godaddy.com → select domain → Secure → downgrade to None (requires identity verification)',
    );
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
  contact?: RegistrantContact,
  onProgress?: ProgressCallback,
): Promise<TransferResult | void> {
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
      // Zone might already exist from a previous run — try to find it
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already exists')) {
        report('Zone already exists, looking up', 'pending');
        const existing = await cloudflare.getZoneByName(domain);
        if (existing) {
          zone = existing;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
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
      const cfRecords = mapGoDaddyToCloudflare(dnsRecords, domain, options.proxied);
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

    // Step 4: Remove privacy if still enabled
    // Note: WHOIS data may be briefly public during transfer (1-5 days).
    // Cloudflare re-enables privacy after transfer completes (privacy: true in request).
    report('Removing WHOIS privacy', 'dns_migrated');
    try {
      await godaddy.removePrivacy(domain);
    } catch (privacyErr) {
      // 409 = Free DBP (can't DELETE, but privacy doesn't block transfer)
      // 404 = Privacy not enabled — that's fine
      const msg = privacyErr instanceof Error ? privacyErr.message : '';
      if (!msg.includes('404') && !msg.includes('409')) {
        report('Privacy removal failed (non-blocking)', 'dns_migrated');
      }
    }
    // GoDaddy locks the resource while processing — wait before next mutation
    await new Promise((r) => setTimeout(r, 5000));

    report('Unlocking + disabling auto-renew', 'dns_migrated');
    await godaddy.prepareForTransfer(domain);

    // Verify unlock — GoDaddy processes this async, so poll
    report('Waiting for unlock to propagate', 'dns_migrated');
    let unlocked = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      const detail = await godaddy.getDomainDetail(domain);
      if (!detail.locked) {
        unlocked = true;
        break;
      }
    }
    if (!unlocked) {
      throw new Error(`Domain ${domain} is still locked after unlock request`);
    }
    state.updateDomainStatus(migrationId, domain, 'unlocked');
    report('Domain unlocked', 'unlocked');

    // Step 5: Get auth code (kept in memory only — never persisted to disk)
    report('Fetching auth code', 'unlocked');
    const authCode = await godaddy.getAuthCode(domain);
    state.updateDomainStatus(migrationId, domain, 'auth_obtained');
    report('Auth code obtained', 'auth_obtained');

    // Step 6: Update nameservers at GoDaddy
    if (nameservers.length > 0) {
      report('Updating nameservers', 'auth_obtained');
      await godaddy.updateNameservers(domain, nameservers);
      state.updateDomainStatus(migrationId, domain, 'ns_changed');
      report('Nameservers updated', 'ns_changed');
    }

    // Step 7: Wait for Cloudflare zone to become active
    if (contact) {
      report('Waiting for zone activation (may take a few minutes)', 'ns_changed');
      await cloudflare.waitForZoneActive(zoneId);

      // Step 8: Validate auth code at Cloudflare
      report('Validating auth code', 'ns_changed');
      await cloudflare.checkAuthCode(domain, authCode);

      // Step 9: Initiate transfer
      report('Initiating transfer', 'ns_changed');
      await cloudflare.initiateTransfer(zoneId, domain, authCode, contact);
      state.updateDomainStatus(migrationId, domain, 'transfer_initiated');
      report('Transfer initiated', 'transfer_initiated');
    } else {
      report('Ready for transfer', 'ns_changed');
    }

    return { authCode };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    // Detect provider from error type name
    const provider = rawMessage.includes('GoDaddy') ? 'godaddy' as const
      : rawMessage.includes('Cloudflare') ? 'cloudflare' as const
      : undefined;
    const message = formatError(err, provider);
    const persistedError = formatError(err, provider, true);
    state.updateDomainStatus(migrationId, domain, 'failed', {
      error: persistedError,
    });
    report(message, 'failed', message);
    throw err;
  }
}
