/**
 * TTL (Time To Live) utility functions for KVM
 *
 * These utilities help with common TTL patterns and provide
 * convenient ways to work with expiration times.
 */

/**
 * TTL time unit constants in milliseconds
 */
export const TTL = {
  /**
   * Time units for easy TTL calculations
   */
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
  YEAR: 365 * 24 * 60 * 60 * 1000,

  /**
   * Common TTL presets for typical use cases
   */
  PRESETS: {
    /** 5 minutes - good for temporary tokens */
    VERY_SHORT: 5 * 60 * 1000,
    /** 15 minutes - good for form sessions */
    SHORT: 15 * 60 * 1000,
    /** 1 hour - good for user sessions */
    MEDIUM: 60 * 60 * 1000,
    /** 24 hours - good for daily caches */
    LONG: 24 * 60 * 60 * 1000,
    /** 7 days - good for remember-me tokens */
    VERY_LONG: 7 * 24 * 60 * 60 * 1000,
  },

  /**
   * Calculate TTL from now to a specific date
   */
  until(date: Date): number {
    const now = Date.now();
    const target = date.getTime();
    const diff = target - now;
    return Math.max(0, diff); // Ensure non-negative
  },

  /**
   * Calculate TTL for a number of time units from now
   */
  fromNow(
    amount: number,
    unit:
      | "seconds"
      | "minutes"
      | "hours"
      | "days"
      | "weeks"
      | "months"
      | "years",
  ): number {
    const multipliers = {
      seconds: TTL.SECOND,
      minutes: TTL.MINUTE,
      hours: TTL.HOUR,
      days: TTL.DAY,
      weeks: TTL.WEEK,
      months: TTL.MONTH,
      years: TTL.YEAR,
    };

    return amount * multipliers[unit];
  },

  /**
   * Get expiration date from TTL milliseconds
   */
  toExpirationDate(ttlMs: number): Date {
    return new Date(Date.now() + ttlMs);
  },

  /**
   * Check if a TTL value is valid (positive number)
   */
  isValid(ttlMs: number): boolean {
    return typeof ttlMs === "number" && ttlMs > 0 && Number.isFinite(ttlMs);
  },

  /**
   * Convert human-readable string to TTL milliseconds
   * Supports formats like: "5m", "1h", "30s", "2d"
   */
  parse(ttlString: string): number {
    const match = ttlString.match(/^(\d+)([smhdwy])$/i);
    if (!match) {
      throw new Error(
        `Invalid TTL format: ${ttlString}. Use format like "5m", "1h", "30s", "2d"`,
      );
    }

    const [, amountStr, unit] = match;
    const amount = parseInt(amountStr, 10);

    const unitMap: Record<string, number> = {
      s: TTL.SECOND,
      m: TTL.MINUTE,
      h: TTL.HOUR,
      d: TTL.DAY,
      w: TTL.WEEK,
      y: TTL.YEAR,
    };

    const multiplier = unitMap[unit.toLowerCase()];
    if (!multiplier) {
      throw new Error(`Unknown time unit: ${unit}`);
    }

    return amount * multiplier;
  },

  /**
   * Format TTL milliseconds into human-readable string
   */
  format(ttlMs: number): string {
    if (ttlMs < TTL.MINUTE) {
      return `${Math.round(ttlMs / TTL.SECOND)}s`;
    } else if (ttlMs < TTL.HOUR) {
      return `${Math.round(ttlMs / TTL.MINUTE)}m`;
    } else if (ttlMs < TTL.DAY) {
      return `${Math.round(ttlMs / TTL.HOUR)}h`;
    } else if (ttlMs < TTL.WEEK) {
      return `${Math.round(ttlMs / TTL.DAY)}d`;
    } else if (ttlMs < TTL.YEAR) {
      return `${Math.round(ttlMs / TTL.WEEK)}w`;
    } else {
      return `${Math.round(ttlMs / TTL.YEAR)}y`;
    }
  },
} as const;

/**
 * TTL configuration for common use cases
 */
export const TTLConfig = {
  /**
   * User session management
   */
  SESSION: {
    /** Short session for sensitive operations */
    SHORT: TTL.PRESETS.SHORT,
    /** Standard user session */
    STANDARD: TTL.PRESETS.MEDIUM,
    /** Extended session with "remember me" */
    EXTENDED: TTL.PRESETS.VERY_LONG,
  },

  /**
   * Verification and security tokens
   */
  TOKEN: {
    /** Email verification tokens */
    EMAIL_VERIFICATION: TTL.fromNow(24, "hours"),
    /** Password reset tokens */
    PASSWORD_RESET: TTL.fromNow(1, "hours"),
    /** OTP codes */
    OTP: TTL.fromNow(5, "minutes"),
    /** API rate limiting tokens */
    RATE_LIMIT: TTL.fromNow(1, "hours"),
  },

  /**
   * Caching configurations
   */
  CACHE: {
    /** Quick cache for frequently accessed data */
    QUICK: TTL.fromNow(5, "minutes"),
    /** Standard cache duration */
    STANDARD: TTL.fromNow(1, "hours"),
    /** Long-term cache for stable data */
    LONG_TERM: TTL.fromNow(1, "days"),
    /** Static content cache */
    STATIC: TTL.fromNow(7, "days"),
  },

  /**
   * Temporary data storage
   */
  TEMPORARY: {
    /** Very short-lived data */
    EPHEMERAL: TTL.fromNow(1, "minutes"),
    /** Form data preservation */
    FORM_DATA: TTL.fromNow(30, "minutes"),
    /** File upload tokens */
    UPLOAD_TOKEN: TTL.fromNow(2, "hours"),
    /** Preview/draft content */
    DRAFT: TTL.fromNow(7, "days"),
  },
} as const;

/**
 * Helper function to create TTL-aware options
 */
export function withTTL(
  ttl: number | string,
  baseOptions: Record<string, any> = {},
): { expireIn: number } & typeof baseOptions {
  const expireIn = typeof ttl === "string" ? TTL.parse(ttl) : ttl;

  if (!TTL.isValid(expireIn)) {
    throw new Error(`Invalid TTL value: ${ttl}`);
  }

  return {
    ...baseOptions,
    expireIn,
  };
}

/**
 * Helper function to create session-specific TTL options
 */
export function sessionTTL(
  type: keyof typeof TTLConfig.SESSION = "STANDARD",
  baseOptions: Record<string, any> = {},
) {
  return withTTL(TTLConfig.SESSION[type], baseOptions);
}

/**
 * Helper function to create cache-specific TTL options
 */
export function cacheTTL(
  type: keyof typeof TTLConfig.CACHE = "STANDARD",
  baseOptions: Record<string, any> = {},
) {
  return withTTL(TTLConfig.CACHE[type], baseOptions);
}

/**
 * Helper function to create token-specific TTL options
 */
export function tokenTTL(
  type: keyof typeof TTLConfig.TOKEN,
  baseOptions: Record<string, any> = {},
) {
  return withTTL(TTLConfig.TOKEN[type], baseOptions);
}

/**
 * Helper function to create temporary data TTL options
 */
export function temporaryTTL(
  type: keyof typeof TTLConfig.TEMPORARY = "FORM_DATA",
  baseOptions: Record<string, any> = {},
) {
  return withTTL(TTLConfig.TEMPORARY[type], baseOptions);
}
