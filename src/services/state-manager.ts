import Conf from 'conf';
import crypto from 'node:crypto';
import type {
  AppConfig,
  MigrationState,
  DomainMigrationState,
  DomainStatus,
} from '../types/config.js';
import type { GoDaddyDnsRecord } from '../types/godaddy.js';

interface StoreSchema {
  config: AppConfig;
  migrations: Record<string, MigrationState>;
  activeMigrationId: string | null;
}

const store = new Conf<StoreSchema>({
  projectName: 'nodaddy',
  configFileMode: 0o600,
  defaults: {
    config: {},
    migrations: {},
    activeMigrationId: null,
  },
});

// --- Config ---

export function getConfig(): AppConfig {
  return store.get('config');
}

export function setConfig(config: Partial<AppConfig>): void {
  const current = store.get('config');
  store.set('config', { ...current, ...config });
}

export function clearConfig(): void {
  store.set('config', {});
}

// --- Migrations ---

export function createMigration(domains: string[]): MigrationState {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const domainStates: Record<string, DomainMigrationState> = {};
  for (const domain of domains) {
    domainStates[domain] = {
      domain,
      status: 'pending',
      dnsRecordsBackup: [],
      lastUpdated: now,
    };
  }

  const migration: MigrationState = {
    id,
    startedAt: now,
    domains: domainStates,
  };

  const migrations = store.get('migrations');
  migrations[id] = migration;
  store.set('migrations', migrations);
  store.set('activeMigrationId', id);

  return migration;
}

// Strip any auth codes left by older versions
function sanitizeMigration(migration: MigrationState): MigrationState {
  for (const domain of Object.values(migration.domains)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (domain as any).authCode;
  }
  return migration;
}

export function getActiveMigration(): MigrationState | null {
  const id = store.get('activeMigrationId');
  if (!id) return null;
  const migrations = store.get('migrations');
  const migration = migrations[id];
  return migration ? sanitizeMigration(migration) : null;
}

export function getMigration(id: string): MigrationState | null {
  const migrations = store.get('migrations');
  const migration = migrations[id];
  return migration ? sanitizeMigration(migration) : null;
}

export function updateDomainStatus(
  migrationId: string,
  domain: string,
  status: DomainStatus,
  extra?: Partial<DomainMigrationState>,
): void {
  const migrations = store.get('migrations');
  const migration = migrations[migrationId];
  if (!migration) throw new Error(`Migration ${migrationId} not found`);

  const domainState = migration.domains[domain];
  if (!domainState) throw new Error(`Domain ${domain} not in migration`);

  migration.domains[domain] = {
    ...domainState,
    ...extra,
    status,
    lastUpdated: new Date().toISOString(),
  };

  store.set('migrations', migrations);
}

export function saveDnsBackup(
  migrationId: string,
  domain: string,
  records: GoDaddyDnsRecord[],
): void {
  updateDomainStatus(migrationId, domain, 'pending', {
    dnsRecordsBackup: records,
  });
}

export function getAllMigrations(): MigrationState[] {
  const migrations = store.get('migrations');
  return Object.values(migrations).sort(
    (a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}

export function getResumableDomains(
  migrationId: string,
): DomainMigrationState[] {
  const migration = getMigration(migrationId);
  if (!migration) return [];

  return Object.values(migration.domains).filter(
    (d) => d.status !== 'completed' && d.status !== 'transfer_initiated',
  );
}
