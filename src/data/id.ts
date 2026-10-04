export function newId(prefix = 'id'): string {
  const c = globalThis.crypto as Crypto | undefined;
  const r = c?.randomUUID ? c.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${prefix}_${r}`;
}
