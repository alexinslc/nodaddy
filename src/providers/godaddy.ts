import { z } from 'zod/v4';
import {
  GoDaddyDomainSchema,
  GoDaddyDnsRecordSchema,
  type GoDaddyDomain,
  type GoDaddyDnsRecord,
  type GoDaddyCredentials,
} from '../types/godaddy.js';
import { godaddyRateLimiter } from '../services/rate-limiter.js';

const BASE_URL = 'https://api.godaddy.com';

export class GoDaddyClient {
  private credentials: GoDaddyCredentials;

  constructor(credentials: GoDaddyCredentials) {
    this.credentials = credentials;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    await godaddyRateLimiter.acquire();

    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `sso-key ${this.credentials.apiKey}:${this.credentials.apiSecret}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new GoDaddyApiError(
        `GoDaddy API error ${res.status}: ${body}`,
        res.status,
        body,
      );
    }

    return res.json() as Promise<T>;
  }

  async listDomains(): Promise<GoDaddyDomain[]> {
    const data = await this.request<unknown[]>(
      '/v1/domains?limit=1000&statuses=ACTIVE',
    );
    return z.array(GoDaddyDomainSchema).parse(data);
  }

  async getDomainDetail(domain: string): Promise<GoDaddyDomain> {
    const data = await this.request<unknown>(`/v1/domains/${domain}`);
    return GoDaddyDomainSchema.parse(data);
  }

  async getDnsRecords(domain: string): Promise<GoDaddyDnsRecord[]> {
    const data = await this.request<unknown[]>(
      `/v1/domains/${domain}/records`,
    );
    return z.array(GoDaddyDnsRecordSchema).parse(data);
  }

  async removePrivacy(domain: string): Promise<void> {
    await this.request(`/v1/domains/${domain}/privacy`, {
      method: 'DELETE',
    });
  }

  async unlockDomain(domain: string): Promise<void> {
    await this.request(`/v1/domains/${domain}`, {
      method: 'PATCH',
      body: JSON.stringify({ locked: false }),
    });
  }

  async disableAutoRenew(domain: string): Promise<void> {
    await this.request(`/v1/domains/${domain}`, {
      method: 'PATCH',
      body: JSON.stringify({ renewAuto: false }),
    });
  }

  async getAuthCode(domain: string): Promise<string> {
    // GoDaddy returns the auth code as a plain string for some TLDs,
    // or as an array with a single string for others
    const res = await fetch(
      `${BASE_URL}/v1/domains/${domain}/transferAuthCode`,
      {
        headers: {
          Authorization: `sso-key ${this.credentials.apiKey}:${this.credentials.apiSecret}`,
        },
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new GoDaddyApiError(
        `Failed to get auth code for ${domain}: ${body}`,
        res.status,
        body,
      );
    }

    const text = await res.text();
    // Try parsing as JSON first, fall back to plain text
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') return parsed;
      if (Array.isArray(parsed) && typeof parsed[0] === 'string')
        return parsed[0];
      return text.replace(/^"|"$/g, '');
    } catch {
      return text.replace(/^"|"$/g, '');
    }
  }

  async updateNameservers(
    domain: string,
    nameservers: string[],
  ): Promise<void> {
    await this.request(`/v1/domains/${domain}`, {
      method: 'PATCH',
      body: JSON.stringify({ nameServers: nameservers }),
    });
  }

  async verifyCredentials(): Promise<boolean> {
    try {
      await this.request('/v1/domains?limit=1');
      return true;
    } catch {
      return false;
    }
  }
}

export class GoDaddyApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string,
  ) {
    super(message);
    this.name = 'GoDaddyApiError';
  }
}
