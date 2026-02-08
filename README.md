# nodaddy

**No** more Go**Daddy**. It's time to leave.

A CLI tool that automates bulk domain transfers from GoDaddy to Cloudflare, because life's too short to click through two different dashboards 800 times.

---

> Inspired by [@gregisenberg](https://x.com/gregisenberg/status/2017293461746053500) — *"I've never met someone under the age of 35 that uses GoDaddy"* — and [@code_rams](https://x.com/code_rams/status/2017487005093859472) discovering why everyone hates it: dark patterns, renewal traps, legacy tech... *"the AOL of domains."*

---

## Before you start

**API Keys** — you'll need credentials from both providers:

- **GoDaddy** — Create a Production API key at [developer.godaddy.com/keys](https://developer.godaddy.com/keys) (not OTE/test). You'll get a key + secret pair.
- **Cloudflare** — Use your **Global API Key** from [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) (bottom of page). You'll also need your account email and Account ID (found on any zone overview page).

> **Why Global API Key?** Cloudflare's scoped tokens don't support `Registrar Domains:Edit`, which is needed for transfers. A scoped token with `Zone:Edit` + `DNS:Edit` works if you only want DNS migration without transferring the domain.

**Disable Domain Protection + Domain Privacy** — GoDaddy's Domain Protection + Domain Privacy block transfers and **cannot be removed via API due to 2FA requests**. You must disable both manually before running `nodaddy`:

### To Disable Domain Protection 🔓 

1. To **Disable Domain Protection** go to: [dcc.godaddy.com/control/portfolio](https://dcc.godaddy.com/control/portfolio)
2. Check the boxes next to the domains you want to transfer
3. Click Protection Plans > Downgrade Protection Plans
4. Select **No Protection** and Confirm Downgrade (requires SMS or authenticator verification)
5. Wait for the change to take effect (can take up to 48 hours, usually ~15 minutes)

### To Disable Domain Privacy 🔓

1. To **Disable Domain Privacy** go to: [dcc.godaddy.com/control/portfolio](https://dcc.godaddy.com/control/portfolio)
2. Check the boxes next to the domains you want to transfer
3. Click Domain Privacy > Change to Off > Save
4. Wait for the change to take effect (can take up to 48 hours, usually ~15 minutes)
5. Now you **should** be ready to use `nodaddy`! 😄

`nodaddy` will check for this during preflight and skip any domains that still have Domain Protection enabled.

**Transfer costs** — each transfer includes a 1-year renewal at Cloudflare's at-cost pricing, billed to the card on file in your Cloudflare account. Make sure you have a payment method set up.

| TLD | Cloudflare | GoDaddy |
|-----|-----------|---------|
| .com | ~$9.15/yr | ~$22/yr |
| .net | ~$10.50/yr | ~$20/yr |
| .org | ~$10.00/yr | ~$22/yr |

Pricing varies by TLD. The CLI shows a cost reminder and asks for confirmation before initiating transfers.

**Environment variables** — optionally skip the interactive prompts:

```bash
export GODADDY_API_KEY=your-key
export GODADDY_API_SECRET=your-secret
export CLOUDFLARE_ACCOUNT_ID=your-account-id

# Global API Key (recommended — supports registrar transfers)
export CLOUDFLARE_API_KEY=your-global-api-key
export CLOUDFLARE_EMAIL=you@example.com

# OR scoped API Token (DNS-only migrations, no transfer support)
# export CLOUDFLARE_API_TOKEN=your-api-token
```

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
nodaddy migrate            # Interactive wizard
nodaddy migrate --all      # Skip domain picker, take them all
nodaddy migrate --dry-run  # Preview without making changes
nodaddy list               # List GoDaddy domains
nodaddy status             # Check transfer progress
nodaddy resume             # Resume interrupted transfers
nodaddy config             # View stored credentials
nodaddy config --reset     # Clear stored credentials
nodaddy cleanup            # Delete all stored credentials, contact info, and history
```

## How it works

For each domain, `nodaddy` automates 8 steps:

1. **Preflight** — Verify domain is active, >60 days old, TLD supported, Domain Protection off
2. **DNS backup** — Export all records from GoDaddy
3. **Zone creation** — Create Cloudflare zone
4. **DNS migration** — Map and recreate records (A, AAAA, CNAME, MX, TXT, SRV, CAA, NS)
5. **Prepare GoDaddy** — Remove privacy, disable auto-renew, unlock domain
6. **Auth code** — Fetch transfer authorization code
7. **Nameservers** — Point domain to Cloudflare's nameservers
8. **Transfer** — Initiate transfer at Cloudflare

Registrant contact info is saved after first entry and reused on future runs — you won't have to type it again. Track progress with `nodaddy status`.

Rate limiting, concurrent batch processing (8 domains at a time), and state persistence are built in. If anything interrupts or fails, run `nodaddy resume`. GoDaddy's API often returns temporary 422 "resource lock" errors after recent dashboard changes — the tool automatically retries with backoff (up to ~105 seconds) so you don't have to babysit it.

When you're done transferring, run `nodaddy cleanup` to remove stored API credentials, contact info, and migration history from your machine.

> **Note:** Domain transfers use undocumented Cloudflare Registrar API endpoints that are not part of Cloudflare's public API. These endpoints could change or break without notice. DNS migration uses the standard, documented API and is unaffected.

GoDaddy parking records and forwarding junk are automatically skipped. DNS records are created with `proxied: false` by default so your traffic routing doesn't change unexpectedly — the wizard gives you the option to enable Cloudflare proxying (orange cloud) if you want it.

## License

MIT
