import { CONFIG } from "@/config";
export const metadata = { title: "Sign in" };

/**
 * Landing page for the emailed link. Signing in takes a button press (a
 * POST) rather than happening on page load, because email security
 * scanners open links automatically and would use up the one-time token.
 */
export default async function VerifyPage(props: { searchParams: Promise<{ token?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <div className="container auth-container">
      <div className="card auth-card">
        <h1>Sign in to {CONFIG.SITE_NAME}</h1>
        {searchParams.token ? (
          <form method="post" action="/api/auth/verify" className="auth-form">
            <input type="hidden" name="token" value={searchParams.token} />
            <button type="submit">Sign in</button>
          </form>
        ) : (
          <p className="error-text">
            This link is missing its sign-in code. <a href="/login">Request a new link</a>.
          </p>
        )}
      </div>
    </div>
  );
}
