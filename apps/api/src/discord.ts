/**
 * Discord webhook URL handling. The URL carries a secret token and is posted to by the server, so it is validated
 * against Discord's own hosts (never an arbitrary URL — that would be an SSRF vector) and masked whenever it is
 * read back, so the token never leaves the server once stored.
 */

const WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

/** True when the URL is a well-formed Discord webhook URL on a Discord host. */
export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_RE.test(url.trim());
}

/** Hides the token segment of a webhook URL for display, keeping the host and webhook id. */
export function maskWebhookUrl(url: string): string {
  const parts = url.trim().split("/");
  if (parts.length < 2) return "•••";
  parts[parts.length - 1] = "•••";
  return parts.join("/");
}
