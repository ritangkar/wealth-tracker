/** "Install app" support. The browser's beforeinstallprompt can fire before the UI mounts, so listen at module load. */
interface BIPEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: BIPEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; emit(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
}

export const isStandalone = (): boolean =>
  (typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches)) ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export const isIOS = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** iOS in-app browsers (Chrome/Firefox/Edge on iOS) can't add to home screen; Safari is needed. */
export const isIOSSafari = (): boolean => isIOS() && !/crios|fxios|edgios|opios/i.test(navigator.userAgent);

export interface InstallState { standalone: boolean; canPrompt: boolean; ios: boolean; iosSafari: boolean }
export const getInstallState = (): InstallState => ({ standalone: installed || isStandalone(), canPrompt: !!deferred, ios: isIOS(), iosSafari: isIOSSafari() });
export const onInstallChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const e = deferred; deferred = null; emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome;
}
