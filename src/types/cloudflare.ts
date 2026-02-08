import { z } from 'zod/v4';

export const CloudflareZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  name_servers: z.array(z.string()).optional(),
});

export type CloudflareZone = z.infer<typeof CloudflareZoneSchema>;

export const CloudflareDnsRecordSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  name: z.string(),
  content: z.string(),
  ttl: z.number(),
  proxied: z.boolean().optional(),
  priority: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type CloudflareDnsRecord = z.infer<typeof CloudflareDnsRecordSchema>;

export interface RegistrantContact {
  first_name: string;
  last_name: string;
  organization: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
}

export type CloudflareCredentials =
  | { authType: 'token'; apiToken: string; accountId: string }
  | { authType: 'global-key'; apiKey: string; email: string; accountId: string };
