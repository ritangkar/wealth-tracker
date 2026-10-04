/** Optional local app lock. Hides the UI behind a PIN. It does NOT encrypt data at rest — see docs. */
import type { Storage } from '../data/storage';

interface LockRecord { salt: string; hash: string; iterations: number; fails: number; lockedUntil: number }
const META = 'lock';
const ITER = 150_000;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return b64(new Uint8Array(bits));
}
export async function setPin(storage: Storage, pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4–8 digits');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await storage.setMeta(META, { salt: b64(salt), hash: await derive(pin, salt, ITER), iterations: ITER, fails: 0, lockedUntil: 0 } satisfies LockRecord);
}
export const clearPin = (storage: Storage) => storage.setMeta(META, undefined);
export const hasPin = async (storage: Storage) => !!(await storage.getMeta<LockRecord>(META));
export async function verifyPin(storage: Storage, pin: string): Promise<{ ok: boolean; waitMs?: number }> {
  const rec = await storage.getMeta<LockRecord>(META);
  if (!rec) return { ok: true };
  const now = Date.now();
  if (rec.lockedUntil > now) return { ok: false, waitMs: rec.lockedUntil - now };
  const ok = (await derive(pin, unb64(rec.salt), rec.iterations)) === rec.hash;
  if (ok) { await storage.setMeta(META, { ...rec, fails: 0, lockedUntil: 0 }); return { ok: true }; }
  const fails = rec.fails + 1;
  const wait = fails >= 5 ? Math.min(15 * 60_000, 2 ** (fails - 5) * 5_000) : 0; // throttle after 5 misses
  await storage.setMeta(META, { ...rec, fails, lockedUntil: wait ? now + wait : 0 });
  return { ok: false, waitMs: wait || undefined };
}
