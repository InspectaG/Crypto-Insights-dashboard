import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the crypto intelligence dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Gatchek Signals \| Crypto Intelligence Desk<\/title>/i);
  assert.match(html, /Market pulse/);
  assert.match(html, /paper trading lab/i);
  assert.match(html, /Daily buy limit/);
  assert.match(html, /Human review stays in the loop/);
  assert.match(html, /Model confidence/i);
  assert.match(html, /Confidence anatomy/i);
  assert.match(html, /Confidence measures evidence agreement/i);
  assert.match(html, /Signal feed/);
  assert.match(html, /CONNECTING LIVE SOURCES/);
  assert.match(html, /Paper autopilot/);
  assert.match(html, /Performance benchmark/);
  assert.match(html, /Signal evidence scorecard/);
  assert.match(html, /FORWARD VALIDATION/);
  assert.match(html, /Every recorded call is automatically checked after 4 and 24 hours/);
  assert.match(html, /automatic paper buys and sells/i);
  assert.match(html, /TRADING LOCKED/);
  assert.match(html, /Performance comparison/);
  assert.match(html, /Risk tolerance/);
  assert.match(html, /Daily investment cap/);
  assert.match(html, /minimum is \$1\/day/i);
  assert.match(html, /One-time paper cash injection/);
  assert.match(html, /Open Coinbase settings/);
  assert.doesNotMatch(html, /Coinbase API key name|ECDSA private key|Write-only secret/i);
  assert.match(html, /not financial advice/i);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/i);
});

test("keeps Coinbase credentials on a separate settings page", async () => {
  const response = await render("/settings");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<title>Coinbase Settings \| Gatchek Signals<\/title>/i);
  assert.match(html, /PRIVATE USER SETTINGS/);
  assert.match(html, /Coinbase API key name/);
  assert.match(html, /ECDSA private key/);
  assert.match(html, /Write-only secret/);
  assert.match(html, /BACK TO DASHBOARD/);
});

test("uses full-page links between the dashboard and settings", async () => {
  const [dashboardSource, settingsSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/settings/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboardSource, /<a className="settingsLink" href="\/settings">/);
  assert.match(dashboardSource, /<a className="manageConnection" href="\/settings">/);
  assert.match(settingsSource, /<a className="backLink" href="\/">/);
  assert.doesNotMatch(`${dashboardSource}\n${settingsSource}`, /from "next\/link"|<Link\b/);
});

test("keeps private-dashboard metadata out of search indexes", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /name="robots" content="noindex, nofollow"/i);
  assert.match(html, /property="og:image" content="https:\/\/crypto\.gatchek\.com\/og\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
});
