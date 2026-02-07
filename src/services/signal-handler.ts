import { getActiveMigration } from './state-manager.js';

export function setupSignalHandlers(): void {
  const handler = (signal: string) => {
    const migration = getActiveMigration();
    if (migration) {
      const domains = Object.values(migration.domains);
      const completed = domains.filter(
        (d) => d.status === 'completed' || d.status === 'transfer_initiated',
      ).length;
      console.log(
        `\n\nInterrupted (${signal}). Migration state saved (${completed}/${domains.length} domains processed).`,
      );
      console.log('Run `nodaddy resume` to continue.\n');
    } else {
      console.log(`\n\nInterrupted (${signal}).\n`);
    }
    process.exit(1);
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}
