import { Command } from 'commander';
import { migrateCommand } from './commands/migrate.js';
import { listCommand } from './commands/list.js';
import { statusCommand } from './commands/status.js';
import { clearConfig } from './services/state-manager.js';

const program = new Command();

program
  .name('nodaddy')
  .description(
    'Bulk domain transfer from GoDaddy to Cloudflare',
  )
  .version('1.0.0');

program
  .command('migrate')
  .description('Interactive migration wizard')
  .option('--all', 'Migrate all domains (skip selection)')
  .option('--dry-run', 'Preview without making changes')
  .action(async (opts) => {
    await migrateCommand(opts);
  });

program
  .command('list')
  .description('List GoDaddy domains')
  .action(async () => {
    await listCommand();
  });

program
  .command('status')
  .description('Check transfer status')
  .action(async () => {
    await statusCommand();
  });

program
  .command('config')
  .description('Manage API credentials')
  .option('--reset', 'Clear stored credentials')
  .action(async (opts) => {
    if (opts.reset) {
      clearConfig();
      console.log('Credentials cleared.');
    } else {
      // Import dynamically to avoid loading all prompts for a simple config check
      const { getConfig } = await import('./services/state-manager.js');
      const config = getConfig();
      const hasGD = config.godaddy?.apiKey ? 'configured' : 'not set';
      const hasCF = config.cloudflare?.apiToken ? 'configured' : 'not set';
      console.log(`GoDaddy:    ${hasGD}`);
      console.log(`Cloudflare: ${hasCF}`);
      console.log(
        '\nRun `nodaddy migrate` to set up credentials, or `nodaddy config --reset` to clear them.',
      );
    }
  });

// Default to migrate if no command specified
program.action(async () => {
  await migrateCommand({});
});

program.parse();
