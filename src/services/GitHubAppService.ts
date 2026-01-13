import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { GitHubAppConnection } from '../types';
import { UserConfigManager } from './UserConfigManager';

// GitHub App configuration from environment
const GITHUB_APP_CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID;
const GITHUB_APP_CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET;

// GitHub OAuth URLs
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

/**
 * Service for managing GitHub App OAuth flow and installation tokens
 */
export class GitHubAppService {
  private userConfigManager: UserConfigManager;

  constructor(userConfigManager: UserConfigManager) {
    this.userConfigManager = userConfigManager;
  }

  /**
   * Check if GitHub App is configured
   */
  isConfigured(): boolean {
    return !!(GITHUB_APP_CLIENT_ID && GITHUB_APP_CLIENT_SECRET);
  }

  /**
   * Generate OAuth authorization URL for a user
   * @param userId - User ID to associate with the OAuth flow
   * @param redirectUri - URI to redirect to after authorization
   * @param state - Optional state parameter for CSRF protection
   */
  getAuthorizationUrl(userId: number, redirectUri: string, state?: string): string {
    if (!GITHUB_APP_CLIENT_ID) {
      throw new Error('GitHub App client ID not configured');
    }

    const params = new URLSearchParams({
      client_id: GITHUB_APP_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: 'repo read:user user:email',
      state: state || `user_${userId}_${Date.now()}`,
    });

    return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param code - Authorization code from GitHub
   */
  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    tokenType: string;
    scope: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET) {
      throw new Error('GitHub App credentials not configured');
    }

    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_APP_CLIENT_ID,
        client_secret: GITHUB_APP_CLIENT_SECRET,
        code,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to exchange code: ${response.statusText}`);
    }

    const data = await response.json() as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    if (!data.access_token) {
      throw new Error('No access token in response');
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type || 'bearer',
      scope: data.scope || '',
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Refresh an expired access token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
    refreshToken?: string;
  }> {
    if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET) {
      throw new Error('GitHub App credentials not configured');
    }

    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_APP_CLIENT_ID,
        client_secret: GITHUB_APP_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const data = await response.json() as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };

    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    if (!data.access_token) {
      throw new Error('No access token in response');
    }

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in || 28800, // Default 8 hours
      refreshToken: data.refresh_token,
    };
  }

  /**
   * Get authenticated user info from GitHub
   */
  async getUserInfo(accessToken: string): Promise<{
    login: string;
    id: number;
    avatarUrl: string;
    name: string | null;
    email: string | null;
  }> {
    const response = await fetch(`${GITHUB_API_URL}/user`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.statusText}`);
    }

    const data = await response.json() as {
      login: string;
      id: number;
      avatar_url: string;
      name: string | null;
      email: string | null;
    };

    return {
      login: data.login,
      id: data.id,
      avatarUrl: data.avatar_url,
      name: data.name,
      email: data.email,
    };
  }

  /**
   * Complete the OAuth flow and save connection to user config
   */
  async completeOAuthFlow(
    userId: number,
    code: string
  ): Promise<GitHubAppConnection> {
    try {
      // Exchange code for tokens
      const tokenData = await this.exchangeCodeForToken(code);

      // Get user info
      const userInfo = await this.getUserInfo(tokenData.accessToken);

      // Calculate expiration time (default 8 hours if not provided)
      const expiresIn = tokenData.expiresIn || 28800;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      // Create connection object
      const connection: GitHubAppConnection = {
        installationId: 0, // Not using installation tokens, using OAuth
        accessToken: tokenData.accessToken,
        accessTokenExpiresAt: expiresAt,
        refreshToken: tokenData.refreshToken,
        scope: tokenData.scope,
        connectedAt: new Date(),
        login: userInfo.login,
        avatarUrl: userInfo.avatarUrl,
      };

      // Save to user config
      await this.userConfigManager.setGitHubConnection(userId, connection);

      logger.info('Completed GitHub OAuth flow', {
        userId,
        login: userInfo.login,
      });

      return connection;
    } catch (error) {
      logger.error('Failed to complete GitHub OAuth flow', {
        userId,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Ensure user has a valid GitHub token, refreshing if necessary
   * Returns the valid token or null if unavailable
   */
  async ensureValidToken(userId: number): Promise<string | null> {
    const config = await this.userConfigManager.getConfig(userId);

    // Check GitHub App connection
    if (config.github?.accessToken) {
      const bufferMs = 5 * 60 * 1000; // 5 minute buffer
      const isExpired = new Date(config.github.accessTokenExpiresAt).getTime() < Date.now() + bufferMs;

      if (!isExpired) {
        return config.github.accessToken;
      }

      // Try to refresh if we have a refresh token
      if (config.github.refreshToken) {
        try {
          const refreshed = await this.refreshAccessToken(config.github.refreshToken);
          const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

          await this.userConfigManager.updateGitHubAccessToken(
            userId,
            refreshed.accessToken,
            newExpiresAt
          );

          // Update refresh token if a new one was provided
          if (refreshed.refreshToken) {
            const updatedConfig = await this.userConfigManager.getConfig(userId);
            if (updatedConfig.github) {
              updatedConfig.github.refreshToken = refreshed.refreshToken;
              await this.userConfigManager.setGitHubConnection(userId, updatedConfig.github);
            }
          }

          logger.info('Refreshed GitHub access token', { userId });
          return refreshed.accessToken;
        } catch (error) {
          logger.warn('Failed to refresh GitHub token', {
            userId,
            error: getErrorMessage(error),
          });
          // Fall through to PAT
        }
      }
    }

    // Fall back to PAT
    if (config.githubPat) {
      return config.githubPat;
    }

    return null;
  }

  /**
   * Disconnect GitHub App connection
   */
  async disconnect(userId: number): Promise<void> {
    await this.userConfigManager.clearGitHubConnection(userId);
    logger.info('Disconnected GitHub App', { userId });
  }

  /**
   * Validate a Personal Access Token
   */
  async validatePat(pat: string): Promise<{
    valid: boolean;
    login?: string;
    scopes?: string[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${GITHUB_API_URL}/user`, {
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        return {
          valid: false,
          error: response.status === 401 ? 'Invalid token' : `GitHub API error: ${response.statusText}`,
        };
      }

      const userData = await response.json() as { login: string };
      const scopes = response.headers.get('x-oauth-scopes')?.split(', ') || [];

      return {
        valid: true,
        login: userData.login,
        scopes,
      };
    } catch (error) {
      return {
        valid: false,
        error: getErrorMessage(error),
      };
    }
  }
}
