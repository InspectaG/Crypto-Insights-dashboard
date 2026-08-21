const allowedEmails = new Set(["gatchek@gmail.com", "gatcho@gmail.com"]);

export function emailForRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local-preview@gatchek.com";
  return request.headers.get("cf-access-authenticated-user-email")?.toLowerCase() ?? null;
}

export function unauthorized(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  const email = emailForRequest(request);
  return !email || !allowedEmails.has(email);
}
