import { useEffect, useState } from 'preact/hooks';
import { Banner, Button, Card } from './kit';
import { getInstallState, onInstallChange, promptInstall, type InstallState } from '../pwa/install';

const KEY = 'wealthos.installDismissedAt';
const REASK_MS = 14 * 24 * 3600 * 1000;
function recentlyDismissed() { try { const t = Number(localStorage.getItem(KEY)); return t > 0 && Date.now() - t < REASK_MS; } catch { return false; } }

export function useInstall() {
  const [s, setS] = useState<InstallState>(getInstallState());
  useEffect(() => onInstallChange(() => setS(getInstallState())), []);
  return s;
}

function IosSteps() {
  return (
    <ol class="install-steps">
      <li>Tap the <b>Share</b> button <span aria-hidden="true">⬆︎</span> at the bottom of Safari</li>
      <li>Scroll and tap <b>Add to Home Screen</b></li>
      <li>Tap <b>Add</b> — then open Wealth OS from your Home Screen</li>
    </ol>
  );
}

/** Dismissible install banner (Home). Hidden once installed / running standalone. */
export function InstallBanner() {
  const s = useInstall();
  const [hidden, setHidden] = useState(recentlyDismissed());
  const [steps, setSteps] = useState(false);
  if (s.standalone || hidden) return null;
  if (!s.canPrompt && !s.ios) return null; // desktop browsers without an install prompt: stay quiet (Settings explains)
  const dismiss = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } setHidden(true); };
  return (
    <div class="install-banner" role="region" aria-label="Install Wealth OS">
      <Banner tone="info" action={<span class="install-actions">
        {s.canPrompt && <Button size="sm" variant="primary" onClick={async () => { const r = await promptInstall(); if (r !== 'unavailable') dismiss(); }}>Install</Button>}
        {!s.canPrompt && s.ios && <Button size="sm" variant="primary" onClick={() => setSteps((v) => !v)}>{steps ? 'Hide steps' : 'How to install'}</Button>}
        <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
      </span>}>
        <b>Install Wealth OS</b> on your {s.ios ? 'iPhone' : 'device'} — opens like an app, works offline, keeps your data private on this device.
        {!s.canPrompt && s.ios && !s.iosSafari && <div class="hint">On iPhone this only works from <b>Safari</b> — open this page in Safari first.</div>}
        {steps && s.ios && <IosSteps />}
      </Banner>
    </div>
  );
}

/** Settings card: always available way to install. */
export function InstallCard() {
  const s = useInstall();
  const [steps, setSteps] = useState(false);
  return (
    <Card title="Install the app">
      {s.standalone ? <p>✓ Installed — you’re running Wealth OS as an app.</p> : (
        <>
          <p class="muted">Installing gives you an app icon, full-screen use and reliable offline access. Your data stays on this device either way.</p>
          {s.canPrompt && <div class="page-actions"><Button variant="primary" onClick={() => promptInstall()}>Install Wealth OS</Button></div>}
          {s.ios && <><div class="page-actions"><Button onClick={() => setSteps((v) => !v)}>{steps ? 'Hide steps' : 'Show iPhone steps'}</Button></div>{steps && <IosSteps />}{!s.iosSafari && <p class="hint">Open this page in Safari to install on iPhone.</p>}</>}
          {!s.canPrompt && !s.ios && <p class="hint">If your browser doesn’t show an install button: Chrome/Edge — menu ⋮ → <b>Install app</b> (or the install icon in the address bar). Firefox desktop doesn’t support installing.</p>}
        </>
      )}
    </Card>
  );
}
