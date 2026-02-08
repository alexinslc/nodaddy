import type { GoDaddyDnsRecord } from '../types/godaddy.js';
import type { CloudflareDnsRecord } from '../types/cloudflare.js';
import type { CloudflareClient } from '../providers/cloudflare.js';

// Record types that should be skipped during migration
const SKIP_TYPES = new Set(['SOA']);

// Records that are GoDaddy-specific parking/forwarding
function isGoDaddyParking(record: GoDaddyDnsRecord): boolean {
  if (
    record.type === 'A' &&
    record.name === '@' &&
    record.data === 'Parked'
  ) {
    return true;
  }
  if (
    record.type === 'CNAME' &&
    (record.data.endsWith('.secureserver.net') ||
      record.data.endsWith('.domaincontrol.com'))
  ) {
    return true;
  }
  return false;
}

export function mapGoDaddyToCloudflare(
  records: GoDaddyDnsRecord[],
  domain: string,
  proxied = false,
): Omit<CloudflareDnsRecord, 'id'>[] {
  const mapped: Omit<CloudflareDnsRecord, 'id'>[] = [];

  for (const record of records) {
    // Skip SOA, NS at apex (Cloudflare manages these), and parking records
    if (SKIP_TYPES.has(record.type)) continue;
    if (record.type === 'NS' && record.name === '@') continue;
    if (isGoDaddyParking(record)) continue;

    const cfRecord = mapRecord(record, domain, proxied);
    if (cfRecord) mapped.push(cfRecord);
  }

  return mapped;
}

function mapRecord(
  record: GoDaddyDnsRecord,
  domain: string,
  proxied: boolean,
): Omit<CloudflareDnsRecord, 'id'> | null {
  // Convert GoDaddy "@" to full domain name
  const name =
    record.name === '@' ? domain : `${record.name}.${domain}`;

  // Cloudflare TTL: 1 = automatic
  const ttl = record.ttl < 120 ? 1 : record.ttl;

  switch (record.type) {
    case 'A':
    case 'AAAA':
      return {
        type: record.type,
        name,
        content: record.data,
        ttl,
        proxied,
      };

    case 'CNAME':
      return {
        type: 'CNAME',
        name,
        content: record.data === '@' ? domain : record.data,
        ttl,
        proxied,
      };

    case 'MX':
      return {
        type: 'MX',
        name,
        content: record.data,
        ttl,
        priority: record.priority ?? 10,
      };

    case 'TXT':
      return {
        type: 'TXT',
        name,
        content: record.data,
        ttl,
      };

    case 'SRV': {
      // GoDaddy has flat SRV fields; Cloudflare uses nested data object
      const srvName = record.service && record.protocol
        ? `${record.service}.${record.protocol}.${name}`
        : name;

      return {
        type: 'SRV',
        name: srvName,
        content: `${record.priority ?? 0} ${record.weight ?? 0} ${record.port ?? 0} ${record.data}`,
        ttl,
        data: {
          priority: record.priority ?? 0,
          weight: record.weight ?? 0,
          port: record.port ?? 0,
          target: record.data,
          service: record.service ?? '',
          proto: record.protocol ?? '',
          name: name,
        },
      };
    }

    case 'CAA': {
      // GoDaddy CAA data format: "flags tag value"
      // e.g., "0 issue letsencrypt.org"
      const parts = record.data.match(/^(\d+)\s+(\S+)\s+(.+)$/);
      if (!parts) return null;

      return {
        type: 'CAA',
        name,
        content: record.data,
        ttl,
        data: {
          flags: parseInt(parts[1]!, 10),
          tag: parts[2],
          value: parts[3],
        },
      };
    }

    case 'NS':
      // Non-apex NS records (apex already filtered above)
      return {
        type: 'NS',
        name,
        content: record.data,
        ttl,
      };

    default:
      // Unknown record type — skip but log
      return null;
  }
}

export async function migrateDnsRecords(
  cloudflare: CloudflareClient,
  zoneId: string,
  records: Omit<CloudflareDnsRecord, 'id'>[],
): Promise<{ created: number; failed: Array<{ record: Omit<CloudflareDnsRecord, 'id'>; error: string }> }> {
  let created = 0;
  const failed: Array<{ record: Omit<CloudflareDnsRecord, 'id'>; error: string }> = [];

  for (const record of records) {
    try {
      await cloudflare.createDnsRecord(zoneId, record);
      created++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Duplicate record errors are OK — Cloudflare jump_start may have added some
      if (message.includes('already exists')) {
        created++;
      } else {
        failed.push({ record, error: message });
      }
    }
  }

  return { created, failed };
}
