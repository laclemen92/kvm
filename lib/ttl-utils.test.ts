import { assertEquals, assertThrows } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { TTL, TTLConfig, withTTL, sessionTTL, cacheTTL, tokenTTL, temporaryTTL } from "./ttl-utils.ts";

Deno.test("TTL constants", () => {
  assertEquals(TTL.SECOND, 1000);
  assertEquals(TTL.MINUTE, 60000);
  assertEquals(TTL.HOUR, 3600000);
  assertEquals(TTL.DAY, 86400000);
  assertEquals(TTL.WEEK, 604800000);
  assertEquals(TTL.MONTH, 2592000000);
  assertEquals(TTL.YEAR, 31536000000);
});

Deno.test("TTL presets", () => {
  assertEquals(TTL.PRESETS.VERY_SHORT, 300000); // 5 minutes
  assertEquals(TTL.PRESETS.SHORT, 900000); // 15 minutes
  assertEquals(TTL.PRESETS.MEDIUM, 3600000); // 1 hour
  assertEquals(TTL.PRESETS.LONG, 86400000); // 24 hours
  assertEquals(TTL.PRESETS.VERY_LONG, 604800000); // 7 days
});

Deno.test("TTL.until", () => {
  const now = Date.now();
  const futureDate = new Date(now + 60000); // 1 minute from now
  const pastDate = new Date(now - 60000); // 1 minute ago
  
  const untilFuture = TTL.until(futureDate);
  // Should be approximately 60000ms (allowing for small execution time)
  assertEquals(untilFuture >= 59900 && untilFuture <= 60100, true);
  
  // Past dates should return 0
  assertEquals(TTL.until(pastDate), 0);
});

Deno.test("TTL.fromNow", () => {
  assertEquals(TTL.fromNow(5, "seconds"), 5000);
  assertEquals(TTL.fromNow(3, "minutes"), 180000);
  assertEquals(TTL.fromNow(2, "hours"), 7200000);
  assertEquals(TTL.fromNow(1, "days"), 86400000);
  assertEquals(TTL.fromNow(2, "weeks"), 1209600000);
  assertEquals(TTL.fromNow(1, "months"), 2592000000);
  assertEquals(TTL.fromNow(1, "years"), 31536000000);
});

Deno.test("TTL.toExpirationDate", () => {
  const now = Date.now();
  const ttl = 60000; // 1 minute
  const expirationDate = TTL.toExpirationDate(ttl);
  
  // Should be approximately 1 minute from now
  const diff = expirationDate.getTime() - now;
  assertEquals(diff >= 59900 && diff <= 60100, true);
});

Deno.test("TTL.isValid", () => {
  // Valid TTL values
  assertEquals(TTL.isValid(1000), true);
  assertEquals(TTL.isValid(0.1), true);
  assertEquals(TTL.isValid(Number.MAX_SAFE_INTEGER), true);
  
  // Invalid TTL values
  assertEquals(TTL.isValid(0), false);
  assertEquals(TTL.isValid(-1000), false);
  assertEquals(TTL.isValid(NaN), false);
  assertEquals(TTL.isValid(Infinity), false);
  assertEquals(TTL.isValid(-Infinity), false);
});

Deno.test("TTL.parse", () => {
  // Valid formats
  assertEquals(TTL.parse("30s"), 30000);
  assertEquals(TTL.parse("5m"), 300000);
  assertEquals(TTL.parse("2h"), 7200000);
  assertEquals(TTL.parse("1d"), 86400000);
  assertEquals(TTL.parse("2w"), 1209600000);
  assertEquals(TTL.parse("1y"), 31536000000);
  
  // Case insensitive
  assertEquals(TTL.parse("30S"), 30000);
  assertEquals(TTL.parse("5M"), 300000);
  
  // Invalid formats
  assertThrows(() => TTL.parse("invalid"), Error, "Invalid TTL format");
  assertThrows(() => TTL.parse("30"), Error, "Invalid TTL format");
  assertThrows(() => TTL.parse("s30"), Error, "Invalid TTL format");
  assertThrows(() => TTL.parse("30x"), Error, "Invalid TTL format");
});

Deno.test("TTL.format", () => {
  // Seconds
  assertEquals(TTL.format(500), "1s");
  assertEquals(TTL.format(30000), "30s");
  assertEquals(TTL.format(59000), "59s");
  
  // Minutes
  assertEquals(TTL.format(60000), "1m");
  assertEquals(TTL.format(300000), "5m");
  assertEquals(TTL.format(3540000), "59m");
  
  // Hours
  assertEquals(TTL.format(3600000), "1h");
  assertEquals(TTL.format(7200000), "2h");
  assertEquals(TTL.format(82800000), "23h");
  
  // Days
  assertEquals(TTL.format(86400000), "1d");
  assertEquals(TTL.format(172800000), "2d");
  assertEquals(TTL.format(518400000), "6d");
  
  // Weeks
  assertEquals(TTL.format(604800000), "1w");
  assertEquals(TTL.format(2419200000), "4w");
  assertEquals(TTL.format(31104000000), "51w");
  
  // Years
  assertEquals(TTL.format(31536000000), "1y");
  assertEquals(TTL.format(63072000000), "2y");
});

Deno.test("TTLConfig.SESSION", () => {
  assertEquals(TTLConfig.SESSION.SHORT, TTL.PRESETS.SHORT);
  assertEquals(TTLConfig.SESSION.STANDARD, TTL.PRESETS.MEDIUM);
  assertEquals(TTLConfig.SESSION.EXTENDED, TTL.PRESETS.VERY_LONG);
});

Deno.test("TTLConfig.TOKEN", () => {
  assertEquals(TTLConfig.TOKEN.EMAIL_VERIFICATION, 86400000); // 24 hours
  assertEquals(TTLConfig.TOKEN.PASSWORD_RESET, 3600000); // 1 hour
  assertEquals(TTLConfig.TOKEN.OTP, 300000); // 5 minutes
  assertEquals(TTLConfig.TOKEN.RATE_LIMIT, 3600000); // 1 hour
});

Deno.test("TTLConfig.CACHE", () => {
  assertEquals(TTLConfig.CACHE.QUICK, 300000); // 5 minutes
  assertEquals(TTLConfig.CACHE.STANDARD, 3600000); // 1 hour
  assertEquals(TTLConfig.CACHE.LONG_TERM, 86400000); // 1 day
  assertEquals(TTLConfig.CACHE.STATIC, 604800000); // 7 days
});

Deno.test("TTLConfig.TEMPORARY", () => {
  assertEquals(TTLConfig.TEMPORARY.EPHEMERAL, 60000); // 1 minute
  assertEquals(TTLConfig.TEMPORARY.FORM_DATA, 1800000); // 30 minutes
  assertEquals(TTLConfig.TEMPORARY.UPLOAD_TOKEN, 7200000); // 2 hours
  assertEquals(TTLConfig.TEMPORARY.DRAFT, 604800000); // 7 days
});

Deno.test("withTTL", () => {
  // With numeric TTL
  const opts1 = withTTL(60000);
  assertEquals(opts1, { expireIn: 60000 });
  
  // With string TTL
  const opts2 = withTTL("5m");
  assertEquals(opts2, { expireIn: 300000 });
  
  // With base options
  const opts3 = withTTL(60000, { foo: "bar", baz: 123 });
  assertEquals(opts3, { foo: "bar", baz: 123, expireIn: 60000 });
  
  // Invalid TTL
  assertThrows(() => withTTL(0), Error, "Invalid TTL value");
  assertThrows(() => withTTL(-1000), Error, "Invalid TTL value");
  assertThrows(() => withTTL("invalid"), Error, "Invalid TTL format");
});

Deno.test("sessionTTL", () => {
  // Default (STANDARD)
  const session1 = sessionTTL();
  assertEquals(session1, { expireIn: TTLConfig.SESSION.STANDARD });
  
  // Specific type
  const session2 = sessionTTL("SHORT");
  assertEquals(session2, { expireIn: TTLConfig.SESSION.SHORT });
  
  const session3 = sessionTTL("EXTENDED");
  assertEquals(session3, { expireIn: TTLConfig.SESSION.EXTENDED });
  
  // With base options
  const session4 = sessionTTL("STANDARD", { userId: "123" });
  assertEquals(session4, { userId: "123", expireIn: TTLConfig.SESSION.STANDARD });
});

Deno.test("cacheTTL", () => {
  // Default (STANDARD)
  const cache1 = cacheTTL();
  assertEquals(cache1, { expireIn: TTLConfig.CACHE.STANDARD });
  
  // Specific type
  const cache2 = cacheTTL("QUICK");
  assertEquals(cache2, { expireIn: TTLConfig.CACHE.QUICK });
  
  const cache3 = cacheTTL("LONG_TERM");
  assertEquals(cache3, { expireIn: TTLConfig.CACHE.LONG_TERM });
  
  const cache4 = cacheTTL("STATIC");
  assertEquals(cache4, { expireIn: TTLConfig.CACHE.STATIC });
  
  // With base options
  const cache5 = cacheTTL("STANDARD", { key: "data" });
  assertEquals(cache5, { key: "data", expireIn: TTLConfig.CACHE.STANDARD });
});

Deno.test("tokenTTL", () => {
  const token1 = tokenTTL("EMAIL_VERIFICATION");
  assertEquals(token1, { expireIn: TTLConfig.TOKEN.EMAIL_VERIFICATION });
  
  const token2 = tokenTTL("PASSWORD_RESET");
  assertEquals(token2, { expireIn: TTLConfig.TOKEN.PASSWORD_RESET });
  
  const token3 = tokenTTL("OTP");
  assertEquals(token3, { expireIn: TTLConfig.TOKEN.OTP });
  
  const token4 = tokenTTL("RATE_LIMIT");
  assertEquals(token4, { expireIn: TTLConfig.TOKEN.RATE_LIMIT });
  
  // With base options
  const token5 = tokenTTL("OTP", { userId: "456" });
  assertEquals(token5, { userId: "456", expireIn: TTLConfig.TOKEN.OTP });
});

Deno.test("temporaryTTL", () => {
  // Default (FORM_DATA)
  const temp1 = temporaryTTL();
  assertEquals(temp1, { expireIn: TTLConfig.TEMPORARY.FORM_DATA });
  
  // Specific type
  const temp2 = temporaryTTL("EPHEMERAL");
  assertEquals(temp2, { expireIn: TTLConfig.TEMPORARY.EPHEMERAL });
  
  const temp3 = temporaryTTL("UPLOAD_TOKEN");
  assertEquals(temp3, { expireIn: TTLConfig.TEMPORARY.UPLOAD_TOKEN });
  
  const temp4 = temporaryTTL("DRAFT");
  assertEquals(temp4, { expireIn: TTLConfig.TEMPORARY.DRAFT });
  
  // With base options
  const temp5 = temporaryTTL("FORM_DATA", { formId: "contact" });
  assertEquals(temp5, { formId: "contact", expireIn: TTLConfig.TEMPORARY.FORM_DATA });
});