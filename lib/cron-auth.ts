import "server-only";

export function verifyCronAuth(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${cronSecret}`) return true;

  if (process.env.NODE_ENV !== "production") {
    const secret = new URL(req.url).searchParams.get("secret");
    if (secret === cronSecret) return true;
  }

  return false;
}
