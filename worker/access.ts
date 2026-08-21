import type { AppUser } from "./types";

export const appUsers: AppUser[] = [
  { id: "justin", email: "gatchek@gmail.com", displayName: "Justin", accountId: "shared" },
  { id: "gatcho", email: "gatcho@gmail.com", displayName: "Gatcho", accountId: "gatcho" },
];

const usersByEmail = new Map(appUsers.map((user) => [user.email, user]));

export function emailForRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local-preview@gatchek.com";
  return request.headers.get("cf-access-authenticated-user-email")?.toLowerCase() ?? null;
}

export function unauthorized(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  const email = emailForRequest(request);
  return !email || !usersByEmail.has(email);
}

export function userForRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return appUsers[0];
  const email = emailForRequest(request);
  return email ? usersByEmail.get(email) ?? null : null;
}
