// Firebase start-up: config, household choice, Google sign-in, membership check, then the app.
import { initializeApp } from 'firebase/app';
import type { FirebaseOptions } from 'firebase/app';
import {
  GoogleAuthProvider, connectAuthEmulator, getAuth, getRedirectResult, onAuthStateChanged, signInWithPopup,
  signInWithRedirect, signOut,
} from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';
import {
  connectFirestoreEmulator, doc, getDoc, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { deviceName, lget, lset, setDeviceName } from './local';
import { FirestoreStore } from './store/firestore';
import { startApp } from './ui/app';
import { HID_RE, askHousehold, hideGate, showError, showLoading, showSignIn, showWrongAccount } from './ui/gate';

const EMULATOR = import.meta.env.MODE === 'emulator';

/** 1. `#h=` in the link (remembered)  2. the remembered one  3. ask. */
async function chooseHousehold(): Promise<string> {
  const m = /[#&]h=([^&]+)/.exec(location.hash);
  if (m) {
    const hid = decodeURIComponent(m[1]).trim().toLowerCase();
    if (HID_RE.test(hid)) {
      lset('hid', hid);
      history.replaceState(null, '', location.pathname + location.search);
      return hid;
    }
  }
  const stored = lget('hid');
  if (stored && HID_RE.test(stored)) return stored;
  const hid = await askHousehold();
  lset('hid', hid);
  return hid;
}

function switchHousehold() {
  lset('hid', null);
  location.replace(location.pathname + location.search);
}

/**
 * Hosting serves the config at /__/firebase/init.json, so nothing per-deployment is in the repo.
 * It's cached so the installed app can start offline.
 */
async function loadConfig(): Promise<FirebaseOptions> {
  if (EMULATOR) return { apiKey: 'demo-key', authDomain: location.host, projectId: 'demo-cupboard', appId: 'demo-app' };
  let cfg: FirebaseOptions | null = null;
  try {
    const r = await fetch('/__/firebase/init.json', { cache: 'no-cache' });
    if (r.ok) {
      cfg = await r.json();
      lset('config', JSON.stringify(cfg));
    }
  } catch {
    /* offline */
  }
  if (!cfg) {
    const cached = lget('config');
    if (cached) cfg = JSON.parse(cached) as FirebaseOptions;
  }
  if (!cfg) throw new Error('Couldn’t load the app’s settings. Check your connection and try again.');
  // Sign in through this site's own /__/auth handler, so it's first-party for Safari's storage rules.
  if (/\.(web\.app|firebaseapp\.com)$/.test(location.hostname)) cfg = { ...cfg, authDomain: location.host };
  return cfg;
}

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

async function signIn(auth: Auth, hid: string) {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    showSignIn(hid, () => signIn(auth, hid), switchHousehold, `Sign-in failed (${code || (e as Error).message}).`);
  }
}

async function openHousehold(db: Firestore, auth: Auth, user: User, hid: string) {
  const other = async () => {
    await signOut(auth);
    location.reload();
  };
  if (!user.emailVerified) {
    showWrongAccount(user.email, hid, other, switchHousehold, 'This account’s email address isn’t verified.');
    return;
  }
  showLoading();
  let name = lget(`name:${hid}`) ?? hid;
  try {
    const snap = await getDoc(doc(db, 'households', hid));
    if (!snap.exists()) {
      showWrongAccount(user.email, hid, other, switchHousehold, `There’s no household called “${hid}”.`);
      return;
    }
    name = (snap.get('name') as string | undefined) ?? hid;
    lset(`name:${hid}`, name);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'permission-denied') {
      showWrongAccount(user.email, hid, other, switchHousehold);
      return;
    }
    // Offline with nothing cached for the household doc: carry on with the cached data.
  }

  const store = new FirestoreStore(db, hid, () => deviceName() || undefined);
  let started = false;
  store.onError((e) => {
    if (!started && (e as { code?: string }).code === 'permission-denied') {
      store.close();
      showWrongAccount(user.email, hid, other, switchHousehold);
    }
  });
  store.subscribe(() => {
    if (started) return;
    started = true;
    hideGate();
    startApp(store, {
      demo: false,
      household: { id: hid, name },
      email: user.email,
      deviceName,
      setDeviceName,
      get: (k) => lget(`${hid}:${k}`),
      set: (k, v) => lset(`${hid}:${k}`, v),
      switchHousehold,
      signOut: async () => {
        store.close();
        await signOut(auth);
        location.reload();
      },
    });
  });
}

export async function boot(): Promise<void> {
  const hid = await chooseHousehold();
  showLoading();
  let cfg: FirebaseOptions;
  try {
    cfg = await loadConfig();
  } catch (e) {
    showError((e as Error).message, () => location.reload());
    return;
  }
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (EMULATOR) {
    connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, location.hostname, 8080);
  }

  getRedirectResult(auth).catch((e) => {
    const code = (e as { code?: string }).code ?? '';
    showSignIn(hid, () => signIn(auth, hid), switchHousehold, `Sign-in failed (${code || (e as Error).message}).`);
  });

  let opened = false;
  onAuthStateChanged(auth, (user) => {
    if (opened) {
      // Signed out (or switched account) elsewhere: start again cleanly.
      if (!user) location.reload();
      return;
    }
    if (!user) {
      showSignIn(hid, () => signIn(auth, hid), switchHousehold);
      return;
    }
    opened = true;
    openHousehold(db, auth, user, hid).catch((e) => showError(String((e as Error).message ?? e), () => location.reload()));
  });
}
