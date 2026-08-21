import assert from "node:assert/strict";
import test from "node:test";

import { unauthorized } from "../worker/access.ts";

test("worker defense-in-depth only accepts the two exact Google identities", () => {
  assert.equal(unauthorized(new Request("https://crypto.gatchek.com")), true);
  assert.equal(unauthorized(new Request("https://crypto.gatchek.com", {
    headers: { "cf-access-authenticated-user-email": "gatchek@gmail.com" },
  })), false);
  assert.equal(unauthorized(new Request("https://crypto.gatchek.com", {
    headers: { "cf-access-authenticated-user-email": "gatcho@gmail.com" },
  })), false);
  assert.equal(unauthorized(new Request("https://crypto.gatchek.com", {
    headers: { "cf-access-authenticated-user-email": "someone@gatchek.com" },
  })), true);
  assert.equal(unauthorized(new Request("http://localhost:3000")), false);
});
