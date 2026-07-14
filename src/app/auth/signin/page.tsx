"use client";

import { Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "That Google account isn't part of this organization — sign in with your work account instead.",
};

function SignInForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  return (
    <div className="w-full max-w-sm rounded-2xl border border-app-border bg-app-card p-8 text-center shadow-2xl">
      <h1 className="bg-gradient-to-r from-purple-300 via-purple-200 to-yellow-200 bg-clip-text text-xl font-bold tracking-tight text-transparent">
        AI Team Editor Performance Dashboard
      </h1>
      <p className="mt-2 text-sm text-app-muted">Sign in with your organization Google account to continue.</p>

      {error && <p className="mt-4 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-300">{ERROR_MESSAGES[error] ?? "Sign-in failed — please try again."}</p>}

      <button
        onClick={() => signIn("google", { callbackUrl })}
        className="mt-6 w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-purple-500"
      >
        Sign in with Google
      </button>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg p-4">
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
