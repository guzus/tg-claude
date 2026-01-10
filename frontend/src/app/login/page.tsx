"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Github, Mail, Sparkles } from "lucide-react";

export default function LoginPage() {
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
            <br />
            <span className="text-xs mt-2 block">Authentication is optional - you can use the app without signing in.</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signIn("github", { callbackUrl: "/" })}
          >
            <Github className="w-4 h-4 mr-2" />
            Continue with GitHub
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signIn("google", { callbackUrl: "/" })}
          >
            <Mail className="w-4 h-4 mr-2" />
            Continue with Google
          </Button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>
          <Button variant="ghost" className="w-full" asChild>
            <a href="/">Continue without signing in</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
