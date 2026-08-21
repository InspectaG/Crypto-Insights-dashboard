"use client";

import { useEffect, useState, type FormEvent } from "react";

type Viewer = { id: "justin" | "gatcho"; email: string; displayName: string };

type CoinbaseConnection = {
  label: string;
  keyHint?: string;
  configured: boolean;
  connected: boolean;
  mode: string;
  accountCount: number;
  permissions: { canView: boolean; canTrade: boolean; canTransfer: boolean; canReceive?: boolean };
  message: string;
};

type CoinbaseStatus = {
  configured: boolean;
  connected: boolean;
  mode: string;
  accountCount: number;
  permissions: { canView: boolean; canTrade: boolean; canTransfer: boolean; canReceive?: boolean };
  realTradingEnabled: false;
  killSwitch: true;
  message: string;
  connections?: CoinbaseConnection[];
};

const emptyStatus: CoinbaseStatus = {
  configured: false,
  connected: false,
  mode: "disconnected",
  accountCount: 0,
  permissions: { canView: false, canTrade: false, canTransfer: false },
  realTradingEnabled: false,
  killSwitch: true,
  message: "Your Coinbase account has not been connected yet.",
};

export default function CoinbaseSettings() {
  const [viewer, setViewer] = useState<Viewer>({ id: "justin", email: "gatchek@gmail.com", displayName: "Justin" });
  const [coinbase, setCoinbase] = useState<CoinbaseStatus>(emptyStatus);
  const [keyName, setKeyName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Credentials are validated server-side before encrypted storage.");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/coinbase/settings", {
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json() as { error?: string; user?: Viewer; coinbase?: CoinbaseStatus };
      if (!response.ok || !result.user || !result.coinbase) {
        throw new Error(result.error ?? "Coinbase settings could not be loaded");
      }
      setViewer(result.user);
      setCoinbase(result.coinbase);
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "Coinbase settings could not be loaded");
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("Validating the key with Coinbase…");
    try {
      const response = await fetch("/api/coinbase/credentials", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyName, privateKey }),
      });
      const result = await response.json() as { error?: string; coinbase?: CoinbaseStatus };
      if (!response.ok || !result.coinbase) throw new Error(result.error ?? "Coinbase connection failed");
      setCoinbase(result.coinbase);
      setKeyName("");
      setPrivateKey("");
      setMessage("Connection verified and saved. The private key will not be displayed again.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Coinbase connection failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeConnection() {
    if (!window.confirm(`Remove ${viewer.displayName}'s saved Coinbase connection?`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/coinbase/credentials", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const result = await response.json() as { error?: string; coinbase?: CoinbaseStatus };
      if (!response.ok || !result.coinbase) throw new Error(result.error ?? "Coinbase connection could not be removed");
      setCoinbase(result.coinbase);
      setKeyName("");
      setPrivateKey("");
      setMessage("Saved Coinbase credentials removed from your account.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Coinbase connection could not be removed");
    } finally {
      setSaving(false);
    }
  }

  const connection = coinbase.connections?.[0];

  return (
    <main className="shell settingsShell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Return to Gatchek Signals dashboard">
          <span className="brandMark">G</span>
          <span>GATCHEK <b>/ SETTINGS</b></span>
        </a>
        <div className="topbarRight">
          <span className="demoPill">PRIVATE CONNECTION SETTINGS</span>
          <span className="viewerName">{viewer.displayName}</span>
          <a className="backLink" href="/">BACK TO DASHBOARD</a>
        </div>
      </header>

      <section className="settingsSection" aria-labelledby="settings-title">
        <div className="paperTitleRow settingsTitle">
          <div>
            <p className="eyebrow">PRIVATE USER SETTINGS</p>
            <h1 id="settings-title">Coinbase connection</h1>
            <p>Connect only {viewer.displayName}&apos;s Coinbase account. Your brother cannot view or use these credentials.</p>
          </div>
          <span className={`statePill ${coinbase.connected ? "safe" : "off"}`}>
            {loading ? "CHECKING" : coinbase.connected ? "VERIFIED" : "NOT CONNECTED"}
          </span>
        </div>

        <div className="settingsGrid">
          <form className="panel credentialForm" onSubmit={(event) => void saveConnection(event)}>
            <div className="credentialSummary">
              <div>
                <span className={`connectionDot ${coinbase.connected ? "connected" : ""}`} />
                <p><strong>{viewer.email}</strong><small>{coinbase.message}</small></p>
              </div>
              {connection?.keyHint && <code>{connection.keyHint}</code>}
            </div>

            <label className="credentialField">
              <span>Coinbase API key name</span>
              <input
                aria-label="Coinbase API key name"
                autoCapitalize="none"
                autoComplete="off"
                placeholder="organizations/…/apiKeys/…"
                spellCheck={false}
                value={keyName}
                onChange={(event) => setKeyName(event.target.value)}
              />
            </label>

            <label className="credentialField">
              <span>ECDSA private key</span>
              <textarea
                aria-label="Coinbase ECDSA private key"
                autoCapitalize="none"
                autoComplete="off"
                placeholder={"-----BEGIN EC PRIVATE KEY-----\n…\n-----END EC PRIVATE KEY-----"}
                rows={6}
                spellCheck={false}
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
              />
            </label>

            <div className="credentialActions">
              <button
                className="paperTradeButton"
                disabled={loading || saving || !keyName.trim() || !privateKey.trim()}
                type="submit"
              >
                {saving ? "Validating…" : coinbase.configured ? "Validate and replace" : "Validate and connect"}
              </button>
              {coinbase.configured && (
                <button className="ghostButton dangerButton" disabled={saving} type="button" onClick={() => void removeConnection()}>
                  Remove connection
                </button>
              )}
            </div>
            <p className="credentialMessage" role="status">{message}</p>
          </form>

          <aside className="panel credentialSafety">
            <div><p className="eyebrow">CREDENTIAL BOUNDARY</p><h2>Protected by design</h2></div>
            <ul>
              <li><strong>Private to this login</strong><span>Each Google-authenticated user has a separate encrypted record.</span></li>
              <li><strong>Write-only secret</strong><span>The private key is never returned to or redisplayed in the browser.</span></li>
              <li><strong>Validated before saving</strong><span>The server confirms the key with Coinbase and rejects Transfer permission.</span></li>
              <li><strong>Trading still locked</strong><span>Saving a key does not enable real orders or change the $0 real-money limit.</span></li>
            </ul>
            <div className="scopeGuide">
              <strong>Recommended key permissions</strong>
              <p>Start with <b>View</b>. Trade may be added later when we build the guarded execution phase. Leave <b>Transfer</b> off.</p>
              <a href="https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication" rel="noreferrer" target="_blank">Open Coinbase key instructions ↗</a>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
