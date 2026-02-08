import { z } from 'zod/v4';
import {
  GoDaddyDomainSchema,
  GoDaddyDnsRecordSchema,
  type GoDaddyDomain,
  type GoDaddyDnsRecord,
  type GoDaddyCredentials,
} from '../types/godaddy.js';
import { godaddyRateLimiter } from '../services/rate-limiter.js';
import { assertValidDomain } from '../services/validation.js';

const BASE_URL = 'https://api.godaddy.com';

// GoDaddy returns 422 "Resource is being used in another request" when
// mutations overlap (especially after recent dashboard changes).
// Retry with linear backoff: 5s, 10s, 15s, 20s, 25s, 30s = 105s total.
const RESOURCE_LOCK_MAX_RETRIES = 6;
const RESOURCE_LOCK_BASE_DELAY_MS = 5_000;

export class GoDaddyClient {
  private credentials: GoDaddyCredentials;

  constructor(credentials: GoDaddyCredentials) {
    this.credentials = credentials;
  }

  /**
   * Core fetch with 422 resource lock retry. All request methods use this.
   */
  private async fetchWithRetry(
    path: string,
    options: RequestInit = {},
    onRetry?: (attempt: number, maxRetries: number, delaySec: number) => void,
  ): Promise<Response> {
    for (let attempt = 0; attempt <= RESOURCE_LOCK_MAX_RETRIES; attempt++) {
      await godaddyRateLimiter.acquire();

      const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
          Authorization: `sso-key ${this.credentials.apiKey}:${this.credentials.apiSecret}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (res.ok) return res;

      const body = await res.text();

      // Retry on 422 resource lock with linear backoff
      if (res.status === 422 && body.includes('Resource is being used') && attempt < RESOURCE_LOCK_MAX_RETRIES) {
        const delay = RESOURCE_LOCK_BASE_DELAY_MS * (attempt + 1);
        onRetry?.(attempt + 1, RESOURCE_LOCK_MAX_RETRIES, delay / 1_000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw new GoDaddyApiError(
        `GoDaddy API error ${res.status}: ${body}`,
        res.status,
        body,
      );
    }

    // Unreachable — loop always returns or throws
    throw new Error('Exhausted retries');
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    onRetry?: (attempt: number, maxRetries: number, delaySec: number) => void,
  ): Promise<T> {
    const res = await this.fetchWithRetry(path, options, onRetry);
    const text = await res.text();
    if (!text) throw new Error('Expected JSON response but got empty body');
    return JSON.parse(text) as T;
  }

  private async requestVoid(
    path: string,
    options: RequestInit = {},
    onRetry?: (attempt: number, maxRetries: number, delaySec: number) => void,
  ): Promise<void> {
    const res = await this.fetchWithRetry(path, options, onRetry);
    // Drain body to allow connection reuse
    await res.text();
  }

  private async requestText(
    path: string,
    onRetry?: (attempt: number, maxRetries: number, delaySec: number) => void,
  ): Promise<string> {
    const res = await this.fetchWithRetry(path, {}, onRetry);
    return res.text();
  }

  async listDomains(): Promise<GoDaddyDomain[]> {
    const data = await this.request<unknown[]>(
      '/v1/domains?limit=1000&statuses=ACTIVE',
    );
    return z.array(GoDaddyDomainSchema).parse(data);
  }

  async getDomainDetail(domain: string): Promise<GoDaddyDomain> {
    assertValidDomain(domain);
    const data = await this.request<unknown>(`/v1/domains/${domain}`);
    return GoDaddyDomainSchema.parse(data);
  }

  async getDnsRecords(domain: string): Promise<GoDaddyDnsRecord[]> {
    assertValidDomain(domain);
    const data = await this.request<unknown[]>(
      `/v1/domains/${domain}/records`,
    );
    return z.array(GoDaddyDnsRecordSchema).parse(data);
  }

  async removePrivacy(
    domain: string,
    onRetry?: (attempt: number, maxRetries: number, delaySec: number) => void,
  ): Promise<void> {
    assertValidDomain(domain);
    await this.requestVoid(
      `/v1/domains/${domain}/privacy`,
      { method: 'DELETE' },
      onRetry,
    );
  }

  async prepareForTransfer(
    domain: string,
    onRetry?: (attempt: number, maxRetries: number, delaySec: number) => void,
  ): Promise<void> {
    assertValidDomain(domain);
    try {
      await this.requestVoid(
        `/v1/domains/${domain}`,
        { method: 'PATCH', body: JSON.stringify({ locked: false, renewAuto: false }) },
        onRetry,
      );
    } catch (err) {
      // If combined PATCH fails for a non-lock reason (e.g. renewAuto rejected),
      // retry with just the critical unlock operation
      if (err instanceof GoDaddyApiError && !err.responseBody.includes('Resource is being used')) {
        await this.requestVoid(
          `/v1/domains/${domain}`,
          { method: 'PATCH', body: JSON.stringify({ locked: false }) },
          onRetry,
        );
      } else {
        throw err;
      }
    }
  }

  async getAuthCode(domain: string): Promise<string> {
    assertValidDomain(domain);
    // Try dedicated endpoint first — not all TLDs support it
    try {
      const text = await this.requestText(
        `/v1/domains/${domain}/transferAuthCode`,
      );
      // Response may be plain string, JSON string, or JSON array
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'string') return parsed;
        if (Array.isArray(parsed) && typeof parsed[0] === 'string')
          return parsed[0];
      } catch {
        // Not JSON — use as-is
      }
      return text.replace(/^"|"$/g, '');
    } catch (err) {
      if (err instanceof GoDaddyApiError && err.statusCode === 404) {
        // Fall back to domain detail endpoint (auth code included for most TLDs)
        const detail = await this.getDomainDetail(domain);
        if (detail.authCode) return detail.authCode;
        throw new GoDaddyApiError(
          `No auth code available for ${domain} — check GoDaddy dashboard`,
          404,
          '',
        );
      }
      throw err;
    }
  }

  async updateNameservers(
    domain: string,
    nameservers: string[],
    onRetry?: (attempt: number, maxRetries: number, delaySec: number) => void,
  ): Promise<void> {
    assertValidDomain(domain);
    await this.requestVoid(
      `/v1/domains/${domain}`,
      { method: 'PATCH', body: JSON.stringify({ nameServers: nameservers }) },
      onRetry,
    );
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
