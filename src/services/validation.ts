const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

export function assertValidDomain(domain: string): void {
  if (domain.length === 0 || domain.length > 253) {
    throw new Error(`Invalid domain name: ${domain}`);
  }

  const labels = domain.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      throw new Error(`Invalid domain name: ${domain}`);
    }
  }

  if (!DOMAIN_RE.test(domain)) {
    throw new Error(`Invalid domain name: ${domain}`);
  }
}
