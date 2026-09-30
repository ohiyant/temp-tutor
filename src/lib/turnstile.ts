/**
 * Cloudflare Turnstile: a free, usually invisible "are you a human" check on
 * the booking form. It's on only when both keys are set (from a free
 * Cloudflare account → Turnstile → Add site):
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY  shown to browsers
 *   TURNSTILE_SECRET_KEY            kept on the server
 * With no keys (e.g. local development) the check is skipped.
 */

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

/** True if Cloudflare confirms the token the browser's widget produced. */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token, remoteip: ip }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] verification request failed:", err);
    return false;
  }
}
