import { Listr } from 'listr2';
import type { GoDaddyClient } from '../providers/godaddy.js';
import type { CloudflareClient } from '../providers/cloudflare.js';
import type { MigrationOptions } from '../types/config.js';
import { transferDomain } from '../services/transfer-engine.js';

interface MigrationContext {
  results: Map<string, { success: boolean; error?: string }>;
}

export function createMigrationTasks(
  domains: string[],
  godaddy: GoDaddyClient,
  cloudflare: CloudflareClient,
  migrationId: string,
  options: MigrationOptions,
): Listr<MigrationContext> {
  return new Listr<MigrationContext>(
    domains.map((domain) => ({
      title: domain,
      task: async (ctx, task) => {
        try {
          await transferDomain(
            godaddy,
            cloudflare,
            domain,
            migrationId,
            options,
            (progress) => {
              task.title = `${domain} — ${progress.step}`;
            },
          );
          ctx.results.set(domain, { success: true });
          task.title = `${domain} ✓`;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          ctx.results.set(domain, { success: false, error: message });
          task.title = `${domain} ✗ ${message}`;
          throw err;
        }
      },
      exitOnError: false,
    })),
    {
      concurrent: 8,
      exitOnError: false,
      rendererOptions: {
        collapseErrors: false,
      },
    },
  );
}
