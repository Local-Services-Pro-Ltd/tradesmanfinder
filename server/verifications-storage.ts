/**
 * Supabase Storage helpers for tradesman verification documents.
 *
 * Why server-side only with the service-role key:
 *   Verification documents (insurance certificates, qualification cards)
 *   contain personal data and licence numbers. We never hand them to the
 *   client directly. Tradesmen upload via a server route that streams the
 *   file to a private bucket; admin viewing is via a short-lived signed
 *   URL minted on demand. There is no public URL form.
 *
 * Bucket layout:
 *   ${SUPABASE_VERIFICATIONS_BUCKET}/{tradesmanId}/{kind}/{timestamp}-{rand}.{ext}
 *
 * Required env:
 *   SUPABASE_URL                          e.g. https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY             service-role JWT (NEVER expose to client)
 *   SUPABASE_VERIFICATIONS_BUCKET         bucket name (default 'tradesman-verifications')
 *
 * If any of these are missing we throw lazily on first use, so the rest of the
 * server can boot in dev / CI without Supabase Storage configured.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

let cachedClient: SupabaseClient | null = null;
let cachedBucket: string | null = null;

function getClient(): { client: SupabaseClient; bucket: string } {
  if (cachedClient && cachedBucket) return { client: cachedClient, bucket: cachedBucket };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL is not set — required for verification uploads");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — required for verification uploads");

  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedBucket = process.env.SUPABASE_VERIFICATIONS_BUCKET || "tradesman-verifications";
  return { client: cachedClient, bucket: cachedBucket };
}

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export const ALLOWED_MIME_TYPES = Object.keys(EXT_BY_MIME);
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export function extensionForMime(mime: string): string | null {
  return EXT_BY_MIME[mime.toLowerCase()] ?? null;
}

/** Build a stable storage path for a fresh upload. */
export function newStoragePath(
  tradesmanId: number,
  kind: "insurance" | "qualification",
  mime: string,
): string {
  const ext = extensionForMime(mime);
  if (!ext) throw new Error(`Unsupported MIME type: ${mime}`);
  const ts = Date.now();
  const rand = randomBytes(6).toString("hex");
  return `${tradesmanId}/${kind}/${ts}-${rand}.${ext}`;
}

/** Stream a buffer to the private bucket. Throws on Supabase error. */
export async function uploadVerificationFile(
  path: string,
  buf: Buffer,
  contentType: string,
): Promise<void> {
  const { client, bucket } = getClient();
  const { error } = await client.storage.from(bucket).upload(path, buf, {
    contentType,
    upsert: false,
    cacheControl: "no-store",
  });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
}

/**
 * Mint a short-lived signed URL for the admin reviewer to fetch the file.
 * Default 5-minute TTL — long enough to click through, short enough that a
 * leaked URL is essentially useless.
 */
export async function signVerificationUrl(path: string, ttlSeconds = 300): Promise<string> {
  const { client, bucket } = getClient();
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`signed URL failed: ${error?.message ?? "no URL returned"}`);
  }
  return data.signedUrl;
}

/** Remove a file from the bucket (used when an upload row is hard-deleted). */
export async function deleteVerificationFile(path: string): Promise<void> {
  const { client, bucket } = getClient();
  const { error } = await client.storage.from(bucket).remove([path]);
  if (error) throw new Error(`storage delete failed: ${error.message}`);
}
