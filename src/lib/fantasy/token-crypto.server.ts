/**
 * Encrypts OAuth refresh/access tokens before they are stored in
 * platform_credentials. Server-only; uses AES-GCM with a key derived from the
 * TOKEN_ENCRYPTION_KEY secret. Values written before encryption existed are
 * read back as-is (they carry no "v1:" prefix).
 */

const PREFIX = "v1:";

async function key(): Promise<CryptoKey | null> {
  const raw = process.env["TOKEN_ENCRYPTION_KEY"];
  if (!raw) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function encryptToken(plain: string): Promise<string> {
  const k = await key();
  if (!k) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(plain)),
  );
  return `${PREFIX}${toB64(iv)}.${toB64(cipher)}`;
}

export async function decryptToken(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const k = await key();
  if (!k) return null;
  const [ivPart, dataPart] = stored.slice(PREFIX.length).split(".");
  if (!ivPart || !dataPart) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivPart) },
      k,
      fromB64(dataPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
