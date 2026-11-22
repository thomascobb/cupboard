import './ui/styles.css';
import { ymOf } from './domain/dates';
import { demoState } from './domain/seed';
import { deviceName, setDeviceName } from './local';
import { MemoryStore } from './store/memory';
import { startApp } from './ui/app';
import { hideGate, showError } from './ui/gate';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}

if (new URLSearchParams(location.search).has('demo')) {
  // The prototype's sample data, in memory only. No sign-in.
  const mem: Record<string, string> = {};
  const store = new MemoryStore(demoState(ymOf(new Date())), deviceName() || undefined);
  hideGate();
  startApp(store, {
    demo: true,
    household: { id: 'demo', name: 'Demo' },
    deviceName,
    setDeviceName,
    get: (k) => mem[k] ?? null,
    set: (k, v) => { if (v === null) delete mem[k]; else mem[k] = v; },
  });
} else {
  // Firebase is only loaded for the real app.
  import('./auth')
    .then((m) => m.boot())
    .catch((e) => showError(`Couldn’t start: ${(e as Error).message ?? e}`, () => location.reload()));
}
