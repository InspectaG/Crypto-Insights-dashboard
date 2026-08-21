import type { AppUserId, WorkerEnv } from "./types";
import {
  loadCoinbaseCredentials,
  type CoinbaseCredentials,
} from "./coinbase-credentials";

const COINBASE_HOST = "api.coinbase.com";

function concatBytes(...parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function derLength(length: number) {
  if (length < 128) return new Uint8Array([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, value: Uint8Array) {
  return concatBytes(new Uint8Array([tag]), derLength(value.length), value);
}

function pemBytes(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toPkcs8(pem: string) {
  const bytes = pemBytes(pem);
  if (pem.includes("BEGIN PRIVATE KEY")) return bytes;
  if (!pem.includes("BEGIN EC PRIVATE KEY")) {
    throw new Error("Coinbase key must be an ES256 EC private key");
  }
  const algorithmIdentifier = new Uint8Array([
    0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
  ]);
  return der(0x30, concatBytes(
    new Uint8Array([0x02, 0x01, 0x00]),
    algorithmIdentifier,
    der(0x04, bytes),
  ));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function rawSignature(signature: Uint8Array) {
  if (signature.length === 64) return signature;
  if (signature[0] !== 0x30) throw new Error("Unsupported Coinbase signature format");
  let offset = 2;
  if (signature[1] & 0x80) offset = 2 + (signature[1] & 0x7f);
  if (signature[offset] !== 0x02) throw new Error("Invalid ECDSA signature");
  const rLength = signature[offset + 1];
  const r = signature.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (signature[offset] !== 0x02) throw new Error("Invalid ECDSA signature");
  const sLength = signature[offset + 1];
  const s = signature.slice(offset + 2, offset + 2 + sLength);
  const output = new Uint8Array(64);
  output.set(r.slice(Math.max(0, r.length - 32)), 32 - Math.min(32, r.length));
  output.set(s.slice(Math.max(0, s.length - 32)), 64 - Math.min(32, s.length));
  return output;
}

async function coinbaseJwt(keyName: string, privateKeyPem: string, method: string, path: string) {
  const now = Math.floor(Date.now() / 1_000);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const header = encodeJson({ alg: "ES256", typ: "JWT", kid: keyName, nonce });
  const payload = encodeJson({
    iss: "cdp",
    nbf: now,
    exp: now + 120,
    sub: keyName,
    uri: `${method.toUpperCase()} ${COINBASE_HOST}${path}`,
  });
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    toPkcs8(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64Url(rawSignature(new Uint8Array(signed)))}`;
}

async function coinbaseGet<T>(credentials: CoinbaseCredentials, path: string) {
  if (!credentials.keyName || !credentials.privateKey) {
    throw new Error("Coinbase credentials are not configured");
  }
  const token = await coinbaseJwt(
    credentials.keyName,
    credentials.privateKey,
    "GET",
    path,
  );
  const response = await fetch(`https://${COINBASE_HOST}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) throw new Error(`Coinbase returned ${response.status}`);
  return response.json() as Promise<T>;
}

type ConnectionMetadata = {
  keyHint?: string;
  updatedAt?: string;
  verifiedAt?: string | null;
};

async function getCoinbaseConnection(
  label: string,
  credentials: Partial<CoinbaseCredentials>,
  metadata: ConnectionMetadata = {},
) {
  const configured = Boolean(credentials.keyName && credentials.privateKey);
  if (!configured) {
    return {
      label,
      ...metadata,
      configured: false,
      connected: false,
      mode: "disconnected",
      accountCount: 0,
      permissions: { canView: false, canTrade: false, canTransfer: false },
      realTradingEnabled: false,
      killSwitch: true,
      message: "Add a Coinbase CDP key with View permission only to begin read-only validation.",
    };
  }
  const completeCredentials: CoinbaseCredentials = {
    keyName: credentials.keyName!,
    privateKey: credentials.privateKey!,
  };

  try {
    const [permissions, accounts] = await Promise.all([
      coinbaseGet<{
        can_view: boolean;
        can_trade: boolean;
        can_transfer: boolean;
        can_receive: boolean;
      }>(completeCredentials, "/api/v3/brokerage/key_permissions"),
      coinbaseGet<{ accounts?: unknown[] }>(completeCredentials, "/api/v3/brokerage/accounts"),
    ]);
    const elevatedScope = permissions.can_trade || permissions.can_transfer;
    return {
      label,
      ...metadata,
      configured: true,
      connected: permissions.can_view,
      mode: permissions.can_transfer ? "scope_review" : permissions.can_trade ? "trade_locked" : "read_only",
      accountCount: accounts.accounts?.length ?? 0,
      permissions: {
        canView: permissions.can_view,
        canTrade: permissions.can_trade,
        canTransfer: permissions.can_transfer,
        canReceive: permissions.can_receive,
      },
      realTradingEnabled: false,
      killSwitch: true,
      message: permissions.can_transfer
        ? "Transfer permission is not allowed. Replace this key with Transfer disabled."
        : elevatedScope
          ? "Trade permission verified. Real order submission remains locked."
        : "Read-only Coinbase connection verified. Real order submission remains unavailable.",
    };
  } catch (error) {
    return {
      label,
      ...metadata,
      configured: true,
      connected: false,
      mode: "error",
      accountCount: 0,
      permissions: { canView: false, canTrade: false, canTransfer: false, canReceive: false },
      realTradingEnabled: false,
      killSwitch: true,
      message: error instanceof Error ? error.message : "Coinbase validation failed",
    };
  }
}

export async function validateCoinbaseCredentials(label: string, credentials: CoinbaseCredentials) {
  const connection = await getCoinbaseConnection(label, credentials);
  if (!connection.connected) throw new Error(connection.message);
  if (connection.permissions.canTransfer) {
    throw new Error("Disable Coinbase Transfer permission before saving this key");
  }
  return connection;
}

export async function getCoinbaseStatus(env: WorkerEnv, userId: AppUserId) {
  const label = userId === "justin" ? "Justin" : "Gatcho";
  let connection;
  if (env.COINBASE_CREDENTIALS_ENCRYPTION_KEY) {
    try {
      const stored = await loadCoinbaseCredentials(env.DB, env.COINBASE_CREDENTIALS_ENCRYPTION_KEY, userId);
      connection = stored
        ? await getCoinbaseConnection(label, stored.credentials, {
          keyHint: stored.keyHint,
          updatedAt: stored.updatedAt,
          verifiedAt: stored.verifiedAt,
        })
        : null;
    } catch {
      connection = {
        label,
        configured: true,
        connected: false,
        mode: "error",
        accountCount: 0,
        permissions: { canView: false, canTrade: false, canTransfer: false, canReceive: false },
        realTradingEnabled: false,
        killSwitch: true,
        message: "Stored Coinbase credentials could not be decrypted. Replace the connection in Settings.",
      };
    }
  }
  if (!connection) {
    connection = userId === "justin"
      ? await getCoinbaseConnection(label, {
        keyName: env.COINBASE_PRIMARY_API_KEY_NAME ?? env.COINBASE_API_KEY_NAME,
        privateKey: env.COINBASE_PRIMARY_API_PRIVATE_KEY ?? env.COINBASE_API_PRIVATE_KEY,
      })
      : await getCoinbaseConnection(label, {
        keyName: env.COINBASE_BROTHER_API_KEY_NAME,
        privateKey: env.COINBASE_BROTHER_API_PRIVATE_KEY,
      });
  }
  const connections = [connection];
  const configured = connections.some((connection) => connection.configured);
  const connected = connections.some((connection) => connection.connected);
  const hasTransferScope = connections.some((connection) => connection.permissions.canTransfer);
  const hasTradeScope = connections.some((connection) => connection.permissions.canTrade);
  return {
    configured,
    connected,
    mode: hasTransferScope ? "scope_review" : hasTradeScope ? "trade_locked" : connected ? "read_only" : "disconnected",
    accountCount: connections.reduce((sum, connection) => sum + connection.accountCount, 0),
    permissions: {
      canView: connections.some((connection) => connection.permissions.canView),
      canTrade: connections.some((connection) => connection.permissions.canTrade),
      canTransfer: connections.some((connection) => connection.permissions.canTransfer),
    },
    realTradingEnabled: false as const,
    killSwitch: true as const,
    message: hasTransferScope
      ? "Transfer permission is not allowed. Replace this Coinbase key."
      : hasTradeScope
        ? "Trade permission is verified, but real order submission remains locked."
      : connected
        ? "Read-only Coinbase validation is active; real order submission remains unavailable."
        : "Your Coinbase account has not been connected yet.",
    connections,
  };
}
