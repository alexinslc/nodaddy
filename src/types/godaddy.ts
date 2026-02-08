import { z } from 'zod/v4';

export const GoDaddyDomainSchema = z.object({
  domain: z.string(),
  domainId: z.number(),
  status: z.string(),
  expires: z.string().optional(),
  expirationProtected: z.boolean().optional(),
  holdRegistrar: z.boolean().optional(),
  locked: z.boolean().optional(),
  privacy: z.boolean().optional(),
  renewAuto: z.boolean().optional(),
  renewable: z.boolean().optional(),
  transferProtected: z.boolean().optional(),
  createdAt: z.string().optional(),
  authCode: z.string().optional(),
  nameServers: z.array(z.string()).nullable().optional(),
});

export type GoDaddyDomain = z.infer<typeof GoDaddyDomainSchema>;

export const GoDaddyDnsRecordSchema = z.object({
  type: z.string(),
  name: z.string(),
  data: z.string(),
  ttl: z.number(),
  priority: z.number().optional(),
  weight: z.number().optional(),
  port: z.number().optional(),
  service: z.string().optional(),
  protocol: z.string().optional(),
});

export type GoDaddyDnsRecord = z.infer<typeof GoDaddyDnsRecordSchema>;

export interface GoDaddyCredentials {
  apiKey: string;
  apiSecret: string;
}
