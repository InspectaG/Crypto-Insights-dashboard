# Cloudflare deployment and access checklist

Production hostname: `crypto.gatchek.com`

## 1. Deploy the Worker

Deploy the validated application as a Cloudflare Worker and attach
`crypto.gatchek.com` as a Custom Domain. A Custom Domain makes the Worker the
origin and lets Cloudflare create the DNS record and certificate.

Do not reuse or replace the apex `gatchek.com` record.

## 2. Configure Google as the identity provider

In Cloudflare Zero Trust, configure Google as an identity provider for the
account. Keep the Google OAuth client secret in Google/Cloudflare only; it must
not appear in this repository or in application environment variables.

## 3. Protect the entire Worker

Create a Cloudflare Access self-hosted application for the Worker. Protect
production and preview URLs so the deployment cannot be reached through an
unguarded `workers.dev` or preview hostname.

Use this policy:

| Setting | Value |
| --- | --- |
| Action | Allow |
| Include selector | Emails |
| Allowed email 1 | `gatcho@gmail.com` |
| Allowed email 2 | `gatchek@gmail.com` |
| Login method | Google |
| Session duration | 24 hours |

Do not use **Everyone**, **Emails ending in `@gmail.com`**, or **One-time PIN**
as an allow rule. Those rules are broader than the requested two-person access.

## 4. Verify before handoff

- Signed out: opening `https://crypto.gatchek.com` shows Cloudflare Access, not
  the dashboard.
- `gatcho@gmail.com`: Google login succeeds and the dashboard loads.
- `gatchek@gmail.com`: Google login succeeds and the dashboard loads.
- Any different Google account: login is denied.
- The `workers.dev` hostname and preview deployments are also protected.
- `/api/market` is protected by the same Access application.
- The main `https://gatchek.com` website remains unchanged.

## 5. Security defaults

- Keep all future provider credentials in Cloudflare secrets.
- Use read-only market data keys whenever a provider requires credentials.
- Do not add exchange trading keys during the MVP.
- Do not enable automatic order execution until signal backtesting, alert
  auditing, and explicit risk limits are complete.
