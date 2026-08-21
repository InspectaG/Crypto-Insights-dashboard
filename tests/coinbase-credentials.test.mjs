import assert from "node:assert/strict";
import test from "node:test";

import {
  coinbaseKeyHint,
  decryptCoinbaseCredentials,
  encryptCoinbaseCredentials,
  normalizeCoinbaseCredentials,
} from "../worker/coinbase-credentials.ts";

const secret = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 1)));
const credentials = {
  keyName: "organizations/example-org/apiKeys/example-key-123456",
  privateKey: "-----BEGIN EC PRIVATE KEY-----\nZmFrZS10ZXN0LWtleQ==\n-----END EC PRIVATE KEY-----",
};

test("Coinbase credentials are encrypted and bound to one user", async () => {
  const encrypted = await encryptCoinbaseCredentials(secret, "justin", credentials);
  assert.doesNotMatch(encrypted.encryptedPayload, /example-key|PRIVATE KEY/);
  assert.equal(encrypted.keyHint, "••••123456");
  assert.deepEqual(
    await decryptCoinbaseCredentials(secret, "justin", encrypted.encryptedPayload, encrypted.iv),
    credentials,
  );
  await assert.rejects(
    decryptCoinbaseCredentials(secret, "gatcho", encrypted.encryptedPayload, encrypted.iv),
  );
});

test("Coinbase credential input accepts only full CDP ECDSA key material", () => {
  assert.deepEqual(normalizeCoinbaseCredentials({
    keyName: credentials.keyName,
    privateKey: credentials.privateKey.replaceAll("\n", "\\n"),
  }), credentials);
  assert.equal(coinbaseKeyHint(credentials.keyName), "••••123456");
  assert.throws(
    () => normalizeCoinbaseCredentials({ keyName: "short-key", privateKey: credentials.privateKey }),
    /full Coinbase key name/i,
  );
  assert.throws(
    () => normalizeCoinbaseCredentials({ keyName: credentials.keyName, privateKey: "secret" }),
    /ECDSA private key/i,
  );
});
