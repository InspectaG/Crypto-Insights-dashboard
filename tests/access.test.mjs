import assert from "node:assert/strict";
import test from "node:test";

import { unauthorized, userForRequest } from "../worker/access.ts";

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

test("each allowed identity maps to a different paper account", () => {
  const justin = userForRequest(new Request("https://crypto.gatchek.com", {
    headers: { "cf-access-authenticated-user-email": "gatchek@gmail.com" },
  }));
  const gatcho = userForRequest(new Request("https://crypto.gatchek.com", {
    headers: { "cf-access-authenticated-user-email": "gatcho@gmail.com" },
  }));
  assert.equal(justin.id, "justin");
  assert.equal(gatcho.id, "gatcho");
  assert.equal(justin.displayName, "Justin");
  assert.equal(gatcho.displayName, "Evan");
  assert.notEqual(justin.accountId, gatcho.accountId);
});

test("Sites authentication maps Evan without trusting Sites headers on the Google SSO domain", () => {
  const sitesEvan = userForRequest(new Request("https://gatchek-signals.inspectasgadgets.chatgpt.site", {
    headers: { "oai-authenticated-user-email": "GATCHO@gmail.com" },
  }));
  assert.equal(sitesEvan?.id, "gatcho");
  assert.equal(sitesEvan?.displayName, "Evan");

  assert.equal(unauthorized(new Request("https://crypto.gatchek.com", {
    headers: { "oai-authenticated-user-email": "gatcho@gmail.com" },
  })), true);
  assert.equal(unauthorized(new Request("https://gatchek-signals.inspectasgadgets.chatgpt.site", {
    headers: { "cf-access-authenticated-user-email": "gatcho@gmail.com" },
  })), true);
});
