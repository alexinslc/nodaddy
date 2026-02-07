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

export const CloudflareApiResponseSchema = <T extends z.ZodType>(resultSchema: T) =>
  z.object({
    success: z.boolean(),
    errors: z.array(z.object({
      code: z.number(),
      message: z.string(),
    })),
    messages: z.array(z.object({
      code: z.number(),
      message: z.string(),
    })).optional(),
    result: resultSchema.nullable(),
  });

export const CloudflareTransferStatusSchema = z.object({
  domain: z.string().optional(),
  status: z.string().optional(),
  can_register: z.boolean().optional(),
});

export type CloudflareTransferStatus = z.infer<typeof CloudflareTransferStatusSchema>;

export type CloudflareCredentials =
  | { authType: 'token'; apiToken: string; accountId: string }
  | { authType: 'global-key'; apiKey: string; email: string; accountId: string };
