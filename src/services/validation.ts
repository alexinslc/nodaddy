const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

export function assertValidDomain(domain: string): void {
  if (!DOMAIN_RE.test(domain) || domain.length > 253) {
    throw new Error(`Invalid domain name: ${domain}`);
  }
}
