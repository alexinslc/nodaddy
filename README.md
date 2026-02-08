# nodaddy

**No** more Go**Daddy**. It's time to leave.

A CLI tool that automates bulk domain transfers from GoDaddy to Cloudflare, because life's too short to click through two different dashboards 800 times.

---

> Inspired by [@gregisenberg](https://x.com/gregisenberg/status/2017293461746053500) — *"I've never met someone under the age of 35 that uses GoDaddy"* — and [@code_rams](https://x.com/code_rams/status/2017487005093859472) discovering why everyone hates it: dark patterns, renewal traps, legacy tech... *"the AOL of domains."*

---

## What it does

Takes your mass GoDaddy domain collection and moves it to Cloudflare in one shot. Every tedious step — DNS backup, privacy removal, domain unlocking, auth codes, nameserver changes, transfer initiation — automated.

Each domain requires ~8 manual steps across two dashboards. For 50 domains, that's 400 clicks you'll never get back. Or you could just run `nodaddy migrate`.

## Install

```bash
npm install -g nodaddy
```

Or run directly:

```bash
npx nodaddy migrate
```

## Usage

```bash
# The main event — interactive wizard walks you through everything
nodaddy migrate

# Skip the domain picker, take them all
nodaddy migrate --all

# Feeling cautious? Preview first
nodaddy migrate --dry-run

# See what you're working with
nodaddy list

# Check on your transfers (they take 1-5 days, patience)
nodaddy status

# Manage your API credentials
nodaddy config
nodaddy config --reset
```

## What happens when you run `migrate`

```
$ nodaddy migrate

  ┌  nodaddy v1.0.0
  │
  ◆  GoDaddy API credentials
  │  API Key: ●●●●●●●●●●●●
  │  API Secret: ●●●●●●●●●●
  │
  ◆  Cloudflare auth method
  │  ● Global API Key (recommended)
  │  ○ Scoped API Token
  │
  │  Email: you@example.com
  │  Global API Key: ●●●●●●●●●●●●
  │  Account ID: ●●●●●●●●●●●● ✓
  │
  ◇  Fetching domains from GoDaddy...
  │  Found 73 domains
  │
  ◆  Select domains to migrate
  │  ◻ example.com (expires 2027-01-15) [locked]
  │  ◻ mysite.io (expires 2026-08-20) [locked]
  │  ◼ oldsite.net (expires 2026-03-01) ⚠ expires soon
  │  ... (space to toggle, a to select all)
  │
  ◇  Running preflight checks...
  │  ✓ 71/73 domains eligible
  │  ✗ 2 ineligible:
  │    - newsite.uk (ccTLD not supported)
  │    - recent.com (transferred 20 days ago, 60-day lock)
  │
  ◇  Migrating domains...
  │
  │  ✓ example.com     [DNS ✓] [Unlock ✓] [Auth ✓] [NS ✓] [Transfer ✓]
  │  ✓ mysite.io       [DNS ✓] [Unlock ✓] [Auth ✓] [NS ✓] [Transfer ✓]
  │  ⠋ portfolio.com   [DNS ✓] [Unlock ✓] [Auth...]
  │  ◻ remaining: 68 domains
  │
  └  Migration initiated for 71 domains!
     Run `nodaddy status` to track transfers.
```

## Prerequisites

You'll need API keys from both sides:

**GoDaddy** — [developer.godaddy.com/keys](https://developer.godaddy.com/keys)
- Create a "Production" API key (not OTE/test)
- You'll get a key + secret pair

**Cloudflare** — [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)

The wizard supports two auth methods:

| Method | Permissions | Best for |
|--------|------------|----------|
| **Global API Key** (recommended) | Full account access | Domain transfers — Cloudflare's scoped tokens don't support Registrar operations |
| Scoped API Token | `Zone:Edit`, `DNS:Edit` | DNS-only migrations (no registrar transfer) |

For full transfers, use your **Global API Key** (found at the bottom of your [API Tokens page](https://dash.cloudflare.com/profile/api-tokens)). You'll also need your account email and Account ID (found on any zone overview page).

> **Why Global API Key?** Cloudflare's scoped API tokens don't currently support `Registrar Domains:Edit`, which is required to initiate domain transfers. If you're only migrating DNS records without transferring the domain, a scoped token works fine.

You can also skip the interactive prompts by setting environment variables:

```bash
export GODADDY_API_KEY=your-key
export GODADDY_API_SECRET=your-secret
export CLOUDFLARE_API_KEY=your-global-api-key
export CLOUDFLARE_EMAIL=you@example.com
export CLOUDFLARE_ACCOUNT_ID=your-account-id
```

## The migration pipeline

For each domain, `nodaddy` runs through this in order:

1. **Preflight** — Verify domain is active, >60 days old, TLD supported
2. **DNS backup** — Export all records from GoDaddy
3. **Zone creation** — Create Cloudflare zone with `jump_start`
4. **DNS migration** — Map and recreate all records (A, AAAA, CNAME, MX, TXT, SRV, CAA, NS)
5. **Prepare GoDaddy** — Remove privacy, disable auto-renew, unlock domain
6. **Auth code** — Fetch EPP/transfer authorization code
7. **Nameservers** — Point domain to Cloudflare's nameservers
8. **Transfer** — Initiate transfer at Cloudflare with auth code

All with rate limiting (GoDaddy: 60 req/min, Cloudflare: 1200 req/5min), concurrent batch processing (8 domains at a time), and state persistence so you can resume if anything interrupts.

## DNS record support

All the record types you care about:

| Type | Supported | Notes |
|------|-----------|-------|
| A | Yes | |
| AAAA | Yes | |
| CNAME | Yes | |
| MX | Yes | Priority preserved |
| TXT | Yes | SPF, DKIM, DMARC, etc. |
| SRV | Yes | Mapped to Cloudflare's nested format |
| CAA | Yes | |
| NS | Yes | Non-apex only (Cloudflare manages apex NS) |

GoDaddy parking records and forwarding junk are automatically skipped. Records are created with `proxied: false` by default so your traffic routing doesn't change unexpectedly.

## Goodbye GoDaddy

Thanks for the domains. Thanks for the Super Bowl ads. Thanks for charging me $20/year for WHOIS privacy that Cloudflare includes for free. Thanks for the checkout page with more upsells than a used car lot. It's been real, but it hasn't been fun.

See you never.

## License

MIT
