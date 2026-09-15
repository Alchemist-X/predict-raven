// URL canonicalization — the dedupe key that prevents the single worst failure
// mode of an iterative forecaster: counting the same source twice across rounds
// and drifting the probability to a false extreme on stale evidence.

export function isLocalResearchUrl(url: string): boolean {
  return /^raven-local:\/\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(url);
}

export function canonicalizeUrl(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";
  // Keep the namespace and case-sensitive stable ID separate from web hosts.
  if (isLocalResearchUrl(s)) return s;
  // Add a scheme so URL() can parse bare hosts.
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, ""); // drop trailing slashes
    if (path === "") path = "/";
    // Drop tracking/query noise and fragments; keep only the stable host+path.
    return `${host}${path}`;
  } catch {
    return s
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  }
}
