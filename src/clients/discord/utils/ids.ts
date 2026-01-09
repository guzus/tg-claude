const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Convert a Discord snowflake ID to a safe numeric key.
 * Keeps stable mapping without JS precision loss.
 */
export function toSafeDiscordId(id: string): number {
  try {
    const value = BigInt(id);
    return Number(value % MAX_SAFE_BIGINT);
  } catch {
    return 0;
  }
}
