import { z } from 'zod/v4';
import {
  CloudflareZoneSchema,
  CloudflareDnsRecordSchema,
  type CloudflareZone,
  type CloudflareDnsRecord,
  type CloudflareCredentials,
} from '../types/cloudflare.js';
import { cloudflareRateLimiter } from '../services/rate-limiter.js';

const BASE_URL = 'https://api.cloudflare.com/client/v4';

export class CloudflareClient {
  private credentials: CloudflareCredentials;

  constructor(credentials: CloudflareCredentials) {
    this.credentials = credentials;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    await cloudflareRateLimiter.acquire();

    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.credentials.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new CloudflareApiError(
        `Cloudflare API error ${res.status}: ${body}`,
        res.status,
        body,
      );
    }

    const json = (await res.json()) as {
      success: boolean;
      errors: Array<{ code: number; message: string }>;
      result: T;
    };

    if (!json.success) {
      const errorMsg = json.errors
        .map((e) => `${e.code}: ${e.message}`)
        .join(', ');
      throw new CloudflareApiError(
        `Cloudflare API error: ${errorMsg}`,
        res.status,
        JSON.stringify(json),
      );
    }

    return json.result;
  }

  async createZone(domain: string): Promise<CloudflareZone> {
    const data = await this.request<unknown>('/zones', {
      method: 'POST',
      body: JSON.stringify({
        name: domain,
        account: { id: this.credentials.accountId },
        jump_start: true,
        type: 'full',
      }),
    });
    return CloudflareZoneSchema.parse(data);
  }

  async getZoneStatus(zoneId: string): Promise<CloudflareZone> {
    const data = await this.request<unknown>(`/zones/${zoneId}`);
    return CloudflareZoneSchema.parse(data);
  }

  async createDnsRecord(
    zoneId: string,
    record: Omit<CloudflareDnsRecord, 'id'>,
  ): Promise<CloudflareDnsRecord> {
    const data = await this.request<unknown>(
      `/zones/${zoneId}/dns_records`,
      {
        method: 'POST',
        body: JSON.stringify(record),
      },
    );
    return CloudflareDnsRecordSchema.parse(data);
  }

  async listDnsRecords(zoneId: string): Promise<CloudflareDnsRecord[]> {
    const data = await this.request<unknown[]>(
      `/zones/${zoneId}/dns_records?per_page=100`,
    );
    return z.array(CloudflareDnsRecordSchema).parse(data);
  }

  async initiateTransfer(
    domain: string,
    authCode: string,
  ): Promise<unknown> {
    return this.request(
      `/accounts/${this.credentials.accountId}/registrar/domains/${domain}/transfer`,
      {
        method: 'POST',
        body: JSON.stringify({ auth_code: authCode }),
      },
    );
  }

  async getTransferStatus(domain: string): Promise<{ status: string }> {
    const data = await this.request<{ status: string }>(
      `/accounts/${this.credentials.accountId}/registrar/domains/${domain}`,
    );
    return data;
  }

  async getAccountId(): Promise<string> {
    const data = await this.request<Array<{ id: string }>>(
      '/accounts?per_page=1',
    );
    if (!data || data.length === 0) {
      throw new CloudflareApiError(
        'No Cloudflare accounts found',
        404,
        '',
      );
    }
    return data[0]!.id;
  }

  async verifyCredentials(): Promise<boolean> {
    try {
      await this.request('/user/tokens/verify');
      return true;
    } catch {
      return false;
    }
  }

  async waitForZoneActive(
    zoneId: string,
    timeoutMs = 300_000,
    pollIntervalMs = 10_000,
  ): Promise<CloudflareZone> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const zone = await this.getZoneStatus(zoneId);
      if (zone.status === 'active') return zone;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new CloudflareApiError(
      `Zone ${zoneId} did not become active within ${timeoutMs / 1000}s`,
      408,
      '',
    );
  }
}

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string,
  ) {
    super(message);
    this.name = 'CloudflareApiError';
  }
}
