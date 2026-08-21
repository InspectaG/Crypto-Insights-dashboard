import type { AppUserId, D1Database } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type CoinbaseCredentials = {
  keyName: string;
  privateKey: string;
};

type CredentialRow = {
  encrypted_payload: string;
  iv: string;
  key_hint: string;
  updated_at: string;
  verified_at: string | null;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importEncryptionKey(secret: string) {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(secret.trim());
  } catch {
    throw new Error("Coinbase credential encryption is not configured correctly");
  }
  if (bytes.byteLength !== 32) {
    throw new Error("Coinbase credential encryption is not configured correctly");
  }
  const keyMaterial = Uint8Array.from(bytes).buffer;
  return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function associatedData(userId: AppUserId) {
  return encoder.encode(`gatchek:coinbase:${userId}:v1`);
}

export function normalizeCoinbaseCredentials(input: Record<string, unknown>): CoinbaseCredentials {
  const keyName = String(input.keyName ?? "").trim();
  const privateKey = String(input.privateKey ?? "").replace(/\\n/g, "\n").trim();
  if (!/^organizations\/[^/\s]+\/apiKeys\/[^/\s]+$/.test(keyName)) {
    throw new Error("Use the full Coinbase key name: organizations/…/apiKeys/…");
  }
  if (keyName.length > 512) throw new Error("Coinbase key name is too long");
  if (privateKey.length > 10_000) throw new Error("Coinbase private key is too long");
  if (!/^-----BEGIN (?:EC )?PRIVATE KEY-----[\s\S]+-----END (?:EC )?PRIVATE KEY-----$/.test(privateKey)) {
    throw new Error("Use the ECDSA private key supplied with the Coinbase API key");
  }
  return { keyName, privateKey };
}

export function coinbaseKeyHint(keyName: string) {
  const keyId = keyName.split("/").at(-1) ?? keyName;
  return `••••${keyId.slice(-6)}`;
}

export async function encryptCoinbaseCredentials(
  secret: string,
  userId: AppUserId,
  credentials: CoinbaseCredentials,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(userId) },
    key,
    encoder.encode(JSON.stringify(credentials)),
  );
  return {
    encryptedPayload: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    keyHint: coinbaseKeyHint(credentials.keyName),
  };
}

export async function decryptCoinbaseCredentials(
  secret: string,
  userId: AppUserId,
  encryptedPayload: string,
  iv: string,
) {
  const key = await importEncryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv), additionalData: associatedData(userId) },
    key,
    base64ToBytes(encryptedPayload),
  );
  return JSON.parse(decoder.decode(decrypted)) as CoinbaseCredentials;
}

export async function saveCoinbaseCredentials(
  db: D1Database,
  secret: string,
  userId: AppUserId,
  credentials: CoinbaseCredentials,
) {
  const encrypted = await encryptCoinbaseCredentials(secret, userId, credentials);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO coinbase_credentials
      (user_id, encrypted_payload, iv, key_hint, created_at, updated_at, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_payload = excluded.encrypted_payload,
       iv = excluded.iv,
       key_hint = excluded.key_hint,
       updated_at = excluded.updated_at,
       verified_at = excluded.verified_at`,
  ).bind(
    userId,
    encrypted.encryptedPayload,
    encrypted.iv,
    encrypted.keyHint,
    now,
    now,
    now,
  ).run();
  return { keyHint: encrypted.keyHint, updatedAt: now, verifiedAt: now };
}

export async function loadCoinbaseCredentials(
  db: D1Database,
  secret: string,
  userId: AppUserId,
) {
  const row = await db.prepare(
    `SELECT encrypted_payload, iv, key_hint, updated_at, verified_at
     FROM coinbase_credentials WHERE user_id = ?`,
  ).bind(userId).first<CredentialRow>();
  if (!row) return null;
  return {
    credentials: await decryptCoinbaseCredentials(secret, userId, row.encrypted_payload, row.iv),
    keyHint: row.key_hint,
    updatedAt: row.updated_at,
    verifiedAt: row.verified_at,
  };
}

export async function deleteCoinbaseCredentials(db: D1Database, userId: AppUserId) {
  await db.prepare("DELETE FROM coinbase_credentials WHERE user_id = ?").bind(userId).run();
}
