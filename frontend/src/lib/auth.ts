import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

/**
 * Generate a consistent numeric user ID from a provider's string ID.
 * Uses a simple hash to convert the string to a positive integer.
 */
function generateNumericUserId(providerId: string): number {
  let hash = 0;
  for (let i = 0; i < providerId.length; i++) {
    const char = providerId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Ensure positive number and reasonable range
  return Math.abs(hash) % 2147483647 || 1;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Required for production deployments (Netlify, Vercel, etc.)
  trustHost: true,
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      // Request repo scope for private repository access
      authorization: {
        params: {
          scope: "read:user user:email repo",
        },
      },
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login", // Redirect auth errors to login page
  },
  callbacks: {
    authorized() {
      // Allow all routes - auth is optional
      return true;
    },
    jwt({ token, user, account }) {
      if (user && account) {
        // Store both the original provider ID and generate a numeric ID
        token.id = user.id;
        token.numericId = generateNumericUserId(`${account.provider}:${user.id}`);
        token.provider = account.provider;
        // Store GitHub access token for repo operations
        if (account.provider === "github" && account.access_token) {
          token.githubAccessToken = account.access_token;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        // Add numeric ID to session for API calls
        (session.user as { numericId?: number }).numericId = token.numericId as number;
        // Add provider info and GitHub token to session
        (session.user as { provider?: string }).provider = token.provider as string;
        (session.user as { githubAccessToken?: string }).githubAccessToken = token.githubAccessToken as string | undefined;
      }
      return session;
    },
  },
});
