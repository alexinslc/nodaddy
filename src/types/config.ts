import type { GoDaddyDnsRecord } from './godaddy.js';

export interface AppConfig {
  godaddy?: {
    apiKey: string;
    apiSecret: string;
  };
  cloudflare?: {
    apiToken: string;
    accountId: string;
  };
}

export type DomainStatus =
  | 'pending'
  | 'dns_migrated'
  | 'unlocked'
  | 'auth_obtained'
  | 'ns_changed'
  | 'transfer_initiated'
  | 'completed'
  | 'failed';

export interface DomainMigrationState {
  domain: string;
  status: DomainStatus;
  dnsRecordsBackup: GoDaddyDnsRecord[];
  cloudflareZoneId?: string;
  cloudflareNameservers?: string[];
  authCode?: string;
  error?: string;
  lastUpdated: string;
}

export interface MigrationState {
  id: string;
  startedAt: string;
  domains: Record<string, DomainMigrationState>;
}

export interface MigrationOptions {
  dryRun: boolean;
  migrateRecords: boolean;
  proxied: boolean;
}
