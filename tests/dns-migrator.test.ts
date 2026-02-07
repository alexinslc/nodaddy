import { describe, it, expect } from 'vitest';
import { mapGoDaddyToCloudflare } from '../src/services/dns-migrator.js';
import type { GoDaddyDnsRecord } from '../src/types/godaddy.js';

const DOMAIN = 'example.com';

function record(overrides: Partial<GoDaddyDnsRecord> & { type: string; name: string; data: string }): GoDaddyDnsRecord {
  return { ttl: 600, ...overrides };
}

describe('mapGoDaddyToCloudflare', () => {
  describe('A records', () => {
    it('maps root A record (@ → full domain)', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'A', name: '@', data: '1.2.3.4' })],
        DOMAIN,
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'A',
        name: 'example.com',
        content: '1.2.3.4',
        ttl: 600,
        proxied: false,
      });
    });

    it('maps subdomain A record', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'A', name: 'www', data: '1.2.3.4' })],
        DOMAIN,
      );
      expect(result[0]!.name).toBe('www.example.com');
    });
  });

  describe('AAAA records', () => {
    it('maps AAAA record', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'AAAA', name: '@', data: '2001:db8::1' })],
        DOMAIN,
      );
      expect(result[0]).toMatchObject({
        type: 'AAAA',
        name: 'example.com',
        content: '2001:db8::1',
        proxied: false,
      });
    });
  });

  describe('CNAME records', () => {
    it('maps CNAME record', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'CNAME', name: 'www', data: 'example.com' })],
        DOMAIN,
      );
      expect(result[0]).toMatchObject({
        type: 'CNAME',
        name: 'www.example.com',
        content: 'example.com',
        proxied: false,
      });
    });

    it('skips GoDaddy secureserver.net parking CNAME', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'CNAME', name: 'www', data: 'parked.secureserver.net' })],
        DOMAIN,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe('MX records', () => {
    it('maps MX record with priority', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'MX', name: '@', data: 'mail.example.com', priority: 5 })],
        DOMAIN,
      );
      expect(result[0]).toMatchObject({
        type: 'MX',
        name: 'example.com',
        content: 'mail.example.com',
        priority: 5,
      });
    });

    it('defaults priority to 10 when missing', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'MX', name: '@', data: 'mail.example.com' })],
        DOMAIN,
      );
      expect(result[0]!.priority).toBe(10);
    });
  });

  describe('TXT records', () => {
    it('maps SPF record', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'TXT', name: '@', data: 'v=spf1 include:_spf.google.com ~all' })],
        DOMAIN,
      );
      expect(result[0]).toMatchObject({
        type: 'TXT',
        name: 'example.com',
        content: 'v=spf1 include:_spf.google.com ~all',
      });
    });

    it('maps DKIM record on subdomain', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'TXT', name: 'google._domainkey', data: 'v=DKIM1; k=rsa; p=MIIBIj...' })],
        DOMAIN,
      );
      expect(result[0]!.name).toBe('google._domainkey.example.com');
    });
  });

  describe('SRV records', () => {
    it('maps SRV record with nested data', () => {
      const result = mapGoDaddyToCloudflare(
        [record({
          type: 'SRV',
          name: '@',
          data: 'sip.example.com',
          priority: 10,
          weight: 60,
          port: 5060,
          service: '_sip',
          protocol: '_tcp',
        })],
        DOMAIN,
      );
      expect(result[0]).toMatchObject({
        type: 'SRV',
        name: '_sip._tcp.example.com',
        data: {
          priority: 10,
          weight: 60,
          port: 5060,
          target: 'sip.example.com',
          service: '_sip',
          proto: '_tcp',
        },
      });
    });

    it('handles SRV without service/protocol', () => {
      const result = mapGoDaddyToCloudflare(
        [record({
          type: 'SRV',
          name: '_sip._tcp',
          data: 'sip.example.com',
          priority: 10,
          weight: 0,
          port: 5060,
        })],
        DOMAIN,
      );
      expect(result[0]!.name).toBe('_sip._tcp.example.com');
    });
  });

  describe('CAA records', () => {
    it('maps CAA record with parsed data', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'CAA', name: '@', data: '0 issue letsencrypt.org' })],
        DOMAIN,
      );
      expect(result[0]).toMatchObject({
        type: 'CAA',
        name: 'example.com',
        content: '0 issue letsencrypt.org',
        data: {
          flags: 0,
          tag: 'issue',
          value: 'letsencrypt.org',
        },
      });
    });

    it('skips malformed CAA records', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'CAA', name: '@', data: 'malformed' })],
        DOMAIN,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe('NS records', () => {
    it('skips apex NS records', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'NS', name: '@', data: 'ns1.godaddy.com' })],
        DOMAIN,
      );
      expect(result).toHaveLength(0);
    });

    it('keeps delegated subdomain NS records', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'NS', name: 'sub', data: 'ns1.other.com' })],
        DOMAIN,
      );
      expect(result[0]).toMatchObject({
        type: 'NS',
        name: 'sub.example.com',
        content: 'ns1.other.com',
      });
    });
  });

  describe('filtering', () => {
    it('skips SOA records', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'SOA', name: '@', data: 'ns1.godaddy.com admin.example.com' })],
        DOMAIN,
      );
      expect(result).toHaveLength(0);
    });

    it('skips GoDaddy parking A record', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'A', name: '@', data: 'Parked' })],
        DOMAIN,
      );
      expect(result).toHaveLength(0);
    });

    it('skips unknown record types', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'UNKNOWN', name: '@', data: 'something' })],
        DOMAIN,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe('TTL normalization', () => {
    it('converts low TTLs to automatic (1)', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'A', name: '@', data: '1.2.3.4', ttl: 60 })],
        DOMAIN,
      );
      expect(result[0]!.ttl).toBe(1);
    });

    it('preserves TTLs >= 120', () => {
      const result = mapGoDaddyToCloudflare(
        [record({ type: 'A', name: '@', data: '1.2.3.4', ttl: 3600 })],
        DOMAIN,
      );
      expect(result[0]!.ttl).toBe(3600);
    });
  });

  describe('mixed record set', () => {
    it('handles a realistic domain with multiple record types', () => {
      const records: GoDaddyDnsRecord[] = [
        record({ type: 'A', name: '@', data: '1.2.3.4' }),
        record({ type: 'A', name: 'www', data: '1.2.3.4' }),
        record({ type: 'CNAME', name: 'mail', data: 'ghs.googlehosted.com' }),
        record({ type: 'MX', name: '@', data: 'aspmx.l.google.com', priority: 1 }),
        record({ type: 'MX', name: '@', data: 'alt1.aspmx.l.google.com', priority: 5 }),
        record({ type: 'TXT', name: '@', data: 'v=spf1 include:_spf.google.com ~all' }),
        record({ type: 'NS', name: '@', data: 'ns1.godaddy.com' }),
        record({ type: 'SOA', name: '@', data: 'ns1.godaddy.com' }),
        record({ type: 'A', name: '@', data: 'Parked' }),
      ];

      const result = mapGoDaddyToCloudflare(records, DOMAIN);
      // Should get: 2 A + 1 CNAME + 2 MX + 1 TXT = 6 (NS@apex, SOA, parking skipped)
      expect(result).toHaveLength(6);
      expect(result.map((r) => r.type).sort()).toEqual([
        'A', 'A', 'CNAME', 'MX', 'MX', 'TXT',
      ]);
    });
  });
});
