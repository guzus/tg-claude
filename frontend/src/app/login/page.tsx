"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Github, Sparkles, AlertCircle, Loader2, Shield, GitBranch } from "lucide-react";

const ERROR_MESSAGES: Record<string, { message: string; suggestion?: string }> = {
  Configuration: {
    message: "Authentication is not configured on this server.",
    suggestion: "Please contact the administrator to set up OAuth credentials."
  },
  AccessDenied: {
    message: "Access was denied.",
    suggestion: "You may not have permission to sign in with this account."
  },
  Verification: {
    message: "The sign-in link has expired.",
    suggestion: "Please try signing in again."
  },
  OAuthSignin: {
    message: "Unable to start sign-in process.",
    suggestion: "Try again or use a different sign-in method."
  },
  OAuthCallback: {
    message: "Sign-in was interrupted.",
    suggestion: "Please try signing in again. If the problem persists, try a different browser."
  },
  OAuthCreateAccount: {
    message: "Unable to create your account.",
    suggestion: "Please try again or contact support if the issue continues."
  },
  EmailCreateAccount: {
    message: "Unable to create account with this email.",
    suggestion: "Please try a different sign-in method."
  },
  Callback: {
    message: "Sign-in callback failed.",
    suggestion: "Please try again. Make sure pop-ups are not blocked."
  },
  OAuthAccountNotLinked: {
    message: "This email is linked to a different sign-in method.",
    suggestion: "Try signing in with the method you originally used."
  },
  SessionRequired: {
    message: "Sign-in required to access this page.",
  },
  Default: {
    message: "An error occurred during sign-in.",
    suggestion: "Please try again or use a different sign-in method."
  },
};

function LoginContent() {
  const router = useRouter();
  const { status } = useSession();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const errorInfo = error ? ERROR_MESSAGES[error] || ERROR_MESSAGES.Default : null;
  const [isLoading, setIsLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Redirect authenticated users to home
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
    }
  }, [status, router]);

  // Show loading while checking auth or redirecting
  if (status === "loading" || status === "authenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleGitHubSignIn = async () => {
    setIsLoading(true);
    setSignInError(null);
    try {
      await signIn("github", { callbackUrl: "/" });
    } catch {
      setSignInError("Unable to connect. Please check your internet connection and try again.");
      setIsLoading(false);
    }
  };

  // Combined error display - URL error takes precedence
  const displayError = errorInfo || (signInError ? { message: signInError } : null);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 p-3 rounded-full bg-primary/10 w-fit">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Welcome to Claude Hub</CardTitle>
          <CardDescription>
            Sign in to sync your settings and access advanced features.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {displayError && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 text-sm bg-destructive/10 rounded-md border border-destructive/20"
            >
              <div className="flex items-start gap-2 text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <span className="font-medium">{displayError.message}</span>
                  {displayError.suggestion && (
                    <p className="text-muted-foreground mt-1 text-xs">{displayError.suggestion}</p>
                  )}
                </div>
              </div>
            </div>
          )}
          <Button
            variant="outline"
            className="w-full h-11"
            onClick={handleGitHubSignIn}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Github className="w-4 h-4 mr-2" />
            )}
            {isLoading ? "Connecting..." : "Continue with GitHub"}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Button variant="ghost" className="w-full" asChild disabled={isLoading}>
            <Link href="/">Continue without signing in</Link>
          </Button>

          {/* Benefits of signing in */}
          <div className="pt-2 border-t space-y-3">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Shield className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
              <div>
                <span className="font-medium text-foreground">Your data stays private</span>
                <p className="mt-0.5">Sign in to isolate your workspaces and settings from other users.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <GitBranch className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
              <div>
                <span className="font-medium text-foreground">Access private repositories</span>
                <p className="mt-0.5">GitHub sign-in automatically grants access to your private repos.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
