type Bucket = { count: number; resetsAt: number };

const buckets = new Map<string, Bucket>();
const windowMs = 15 * 60 * 1000;
const maxRequests = 12;

export function rateLimit(key: string, now = Date.now()): boolean {
  const current = buckets.get(key);
  if (!current || current.resetsAt <= now) {
    buckets.set(key, { count: 1, resetsAt: now + windowMs });
    return true;
  }
  if (current.count >= maxRequests) return false;
  current.count += 1;
  return true;
}

export function requestKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}
