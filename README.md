# Gatchek Signals

A private crypto intelligence dashboard for `crypto.gatchek.com`. The MVP
combines live market prices with clearly identified simulated news, social,
whale, and derivatives signals so the scoring and review workflow can be tested
before paid data vendors or automated trading are introduced.

## MVP capabilities

- Live BTC, ETH, and SOL price, 24-hour change, and volume snapshots from the
  public Coinbase Exchange product statistics endpoint.
- Explainable signal direction, confidence, horizon, evidence, and invalidation.
- Whale, social, market, and news event feed with bias filters.
- Responsive, keyboard-accessible dashboard UI.
- Deterministic fallback data when the upstream market feed is unavailable.
- Search-engine exclusion metadata and an explicit simulated-data indicator.
- Cloudflare Access deployment plan restricted to exactly two Google accounts.

Signals are experimental decision support. They are not financial advice, a
promise of profit, or authorization to execute a trade.

## Local development

Requires Node.js 22.13 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

Production verification:

```bash
pnpm build
pnpm test
```

No API key is required for the MVP market feed. Future news, social, and whale
provider credentials must be stored as Cloudflare secrets and must never be
committed to this repository.

## Deployment and access

The application targets Cloudflare Workers at `crypto.gatchek.com`. Before the
hostname is made available, Cloudflare Access must protect the entire Worker and
its preview deployments with Google authentication and an exact email allowlist:

- `gatcho@gmail.com`
- `gatchek@gmail.com`

See [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md) for the
deployment and verification checklist.

## Data boundaries

| Surface | MVP source | Status |
| --- | --- | --- |
| Price and volume | Coinbase Exchange public REST API | Live with fallback |
| News sentiment | Representative event fixtures | Simulated |
| Social velocity | Representative event fixtures | Simulated |
| Whale activity | Representative event fixtures | Simulated |
| Signal score | Transparent deterministic preview | Experimental |

The next data milestone is to replace each fixture category independently,
retain source links and timestamps, and backtest thresholds before alerts are
used for real decisions.
