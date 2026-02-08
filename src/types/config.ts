import type { GoDaddyDnsRecord } from './godaddy.js';
import type { RegistrantContact } from './cloudflare.js';

export interface AppConfig {
  godaddy?: {
    apiKey: string;
    apiSecret: string;
  };
  cloudflare?: {
    authType: 'token' | 'global-key';
    apiToken?: string;
    apiKey?: string;
    email?: string;
    accountId: string;
  };
  registrantContact?: RegistrantContact;
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
