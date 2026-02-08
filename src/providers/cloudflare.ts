import { z } from 'zod/v4';
import {
  CloudflareZoneSchema,
  CloudflareDnsRecordSchema,
  type CloudflareZone,
  type CloudflareDnsRecord,
  type CloudflareCredentials,
  type RegistrantContact,
} from '../types/cloudflare.js';
import { cloudflareRateLimiter } from '../services/rate-limiter.js';
import { assertValidDomain } from '../services/validation.js';

const BASE_URL = 'https://api.cloudflare.com/client/v4';

export class CloudflareClient {
  private credentials: CloudflareCredentials;

  constructor(credentials: CloudflareCredentials) {
    this.credentials = credentials;
  }

  private authHeaders(): Record<string, string> {
    if (this.credentials.authType === 'global-key') {
      return {
        'X-Auth-Key': this.credentials.apiKey,
        'X-Auth-Email': this.credentials.email,
      };
    }
    return {
      Authorization: `Bearer ${this.credentials.apiToken}`,
    };
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    await cloudflareRateLimiter.acquire();

    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        ...this.authHeaders(),
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

    const text = await res.text();
    if (!text) throw new Error('Expected JSON response but got empty body');

    const json = JSON.parse(text) as {
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
    assertValidDomain(domain);
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

  async getZoneByName(domain: string): Promise<CloudflareZone | null> {
    assertValidDomain(domain);
    const data = await this.request<unknown[]>(
      `/zones?name=${encodeURIComponent(domain)}&account.id=${this.credentials.accountId}`,
    );
    const zones = z.array(CloudflareZoneSchema).parse(data);
    return zones[0] ?? null;
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

  async verifyCredentials(): Promise<boolean> {
    try {
      const endpoint = this.credentials.authType === 'global-key'
        ? '/user'
        : '/user/tokens/verify';
      await this.request(endpoint);
      return true;
    } catch {
      return false;
    }
  }

  async checkAuthCode(
    domain: string,
    authCode: string,
  ): Promise<{ message: string }> {
    assertValidDomain(domain);
    const encoded = Buffer.from(authCode).toString('base64');
    return this.request<{ message: string }>(
      `/accounts/${this.credentials.accountId}/registrar/domains/${domain}/check_auth`,
      {
        method: 'POST',
        body: JSON.stringify({ auth_code: encoded }),
      },
    );
  }

  async initiateTransfer(
    zoneId: string,
    domain: string,
    authCode: string,
    contact: RegistrantContact,
  ): Promise<{ name: string; message: string }> {
    assertValidDomain(domain);
    const encoded = Buffer.from(authCode).toString('base64');
    return this.request<{ name: string; message: string }>(
      `/zones/${zoneId}/registrar/domains/${domain}/transfer`,
      {
        method: 'POST',
        body: JSON.stringify({
          auth_code: encoded,
          auto_renew: true,
          years: 1,
          privacy: true,
          import_dns: true,
          registrant: contact,
          fee_acknowledgement: {
            transfer_fee: 0,
            icann_fee: 0,
          },
        }),
      },
    );
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
