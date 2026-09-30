import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; signedOut?: string };
}) {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className="container auth-container">
      <div className="card auth-card">
        <h1>Tutor sign-in</h1>
        <p className="auth-sub">We&apos;ll email you a link to sign in. No password needed.</p>
        {searchParams.error === "link" && (
          <p className="error-text">That sign-in link has expired or was already used. Request a new one below.</p>
        )}
        {searchParams.signedOut && <p className="auth-info">You&apos;re signed out.</p>}
        <LoginForm />
      </div>
    </div>
  );
}
