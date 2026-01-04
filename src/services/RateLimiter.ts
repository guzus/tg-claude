import { UserActivity } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class RateLimiter {
  private userActivity: Map<number, UserActivity> = new Map();

  /**
   * Check if user has exceeded rate limits
   */
  checkRateLimit(userId: number): { allowed: boolean; reason?: string } {
    const now = new Date();
    let activity = this.userActivity.get(userId);

    // Initialize user activity if not exists
    if (!activity) {
      activity = {
        userId,
        requestsThisHour: 0,
        requestsToday: 0,
        lastRequestTime: now,
        hourStartTime: now,
        dayStartTime: now
      };
      this.userActivity.set(userId, activity);
    }

    // Reset hourly counter if hour has passed
    const hoursPassed = (now.getTime() - activity.hourStartTime.getTime()) / (1000 * 60 * 60);
    if (hoursPassed >= 1) {
      activity.requestsThisHour = 0;
      activity.hourStartTime = now;
    }

    // Reset daily counter if day has passed
    const daysPassed = (now.getTime() - activity.dayStartTime.getTime()) / (1000 * 60 * 60 * 24);
    if (daysPassed >= 1) {
      activity.requestsToday = 0;
      activity.dayStartTime = now;
    }

    // Check hourly limit
    if (activity.requestsThisHour >= config.maxRequestsPerUserPerHour) {
      const minutesUntilReset = Math.ceil(
        60 - ((now.getTime() - activity.hourStartTime.getTime()) / (1000 * 60))
      );
      logger.warn('User exceeded hourly rate limit', { userId });
      return {
        allowed: false,
        reason: `Rate limit exceeded. Please try again in ${minutesUntilReset} minutes.`
      };
    }

    // Check daily limit
    if (activity.requestsToday >= config.maxRequestsPerUserPerDay) {
      const hoursUntilReset = Math.ceil(
        24 - ((now.getTime() - activity.dayStartTime.getTime()) / (1000 * 60 * 60))
      );
      logger.warn('User exceeded daily rate limit', { userId });
      return {
        allowed: false,
        reason: `Daily limit exceeded. Please try again in ${hoursUntilReset} hours.`
      };
    }

    // Increment counters
    activity.requestsThisHour++;
    activity.requestsToday++;
    activity.lastRequestTime = now;

    return { allowed: true };
  }

  /**
   * Get user activity stats
   */
  getUserStats(userId: number): UserActivity | undefined {
    return this.userActivity.get(userId);
  }

  /**
   * Reset rate limits for a user
   */
  resetUserLimits(userId: number): void {
    const now = new Date();
    const activity = this.userActivity.get(userId);

    if (activity) {
      activity.requestsThisHour = 0;
      activity.requestsToday = 0;
      activity.hourStartTime = now;
      activity.dayStartTime = now;
      logger.info('Reset rate limits for user', { userId });
    }
  }

  /**
   * Get remaining requests for user
   */
  getRemainingRequests(userId: number): { hourly: number; daily: number } {
    const activity = this.userActivity.get(userId);

    if (!activity) {
      return {
        hourly: config.maxRequestsPerUserPerHour,
        daily: config.maxRequestsPerUserPerDay
      };
    }

    return {
      hourly: Math.max(0, config.maxRequestsPerUserPerHour - activity.requestsThisHour),
      daily: Math.max(0, config.maxRequestsPerUserPerDay - activity.requestsToday)
    };
  }

  /**
   * Clean up old user activity data
   */
  cleanup(): number {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    let cleanedCount = 0;

    for (const [userId, activity] of this.userActivity.entries()) {
      if (now - activity.lastRequestTime.getTime() > maxAge) {
        this.userActivity.delete(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old user activity', { count: cleanedCount });
    }

    return cleanedCount;
  }
}
