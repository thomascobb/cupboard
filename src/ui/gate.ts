// Full-screen states shown before the app: loading, which household, sign in, wrong account, errors.
import { esc } from './html';

const gate = () => document.getElementById('gate')!;

function show(html: string) {
  const g = gate();
  g.innerHTML = `<div class="gate-card">${html}</div>`;
  g.hidden = false;
  document.getElementById('app')!.hidden = true;
}

export function hideGate() {
  gate().hidden = true;
  gate().innerHTML = '';
}

export function showLoading(what = '') {
  show(`<h1>Cupboard</h1>${what ? `<p>${esc(what)}</p>` : ''}<div class="spinner" aria-label="Loading"></div>`);
}

export const HID_RE = /^[a-z0-9-]{1,40}$/;

/** One field: the household id. Resolves with a valid id. */
export function askHousehold(initial = ''): Promise<string> {
  show(`<h1>Which household?</h1>
    <p>Type the household name from the link you were sent (the part after <strong>#h=</strong>).</p>
    <form id="hh-form" novalidate>
      <label class="field"><input id="hh" value="${esc(initial)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Household" placeholder="e.g. home"></label>
      <p class="err" id="hh-err" hidden></p>
      <button class="primary" type="submit">Continue</button>
    </form>`);
  const input = document.getElementById('hh') as HTMLInputElement;
  input.focus();
  return new Promise((resolve) => {
    document.getElementById('hh-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim().toLowerCase().replace(/^.*#h=/, '');
      if (HID_RE.test(v)) return resolve(v);
      const err = document.getElementById('hh-err')!;
      err.textContent = 'Use letters, numbers and dashes, like “home”.';
      err.hidden = false;
    });
  });
}

export function showSignIn(hid: string, onSignIn: () => void, onSwitch: () => void, error?: string) {
  show(`<h1>Cupboard</h1>
    <p>Sign in with Google to open household <strong>${esc(hid)}</strong>.</p>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <button class="primary" id="signin">Sign in with Google</button>
    <button class="text-btn" id="switch">Not ${esc(hid)}? Change household</button>`);
  document.getElementById('signin')!.addEventListener('click', onSignIn);
  document.getElementById('switch')!.addEventListener('click', onSwitch);
}

export function showWrongAccount(email: string | null, hid: string, onOther: () => void, onSwitch: () => void, reason?: string) {
  show(`<h1>No access</h1>
    <p>${reason ? esc(reason) : `This Google account${email ? ` (<strong>${esc(email)}</strong>)` : ''} isn’t in household <strong>${esc(hid)}</strong>.`}</p>
    <p>Ask whoever runs your Cupboard to add it, or sign in with the account they added.</p>
    <button class="primary" id="other">Sign out and switch account</button>
    <button class="text-btn" id="switch">Change household</button>`);
  document.getElementById('other')!.addEventListener('click', onOther);
  document.getElementById('switch')!.addEventListener('click', onSwitch);
}

export function showError(msg: string, retry?: () => void) {
  show(`<h1>Cupboard</h1><p class="err">${esc(msg)}</p>${retry ? '<button class="primary" id="retry">Try again</button>' : ''}`);
  if (retry) document.getElementById('retry')!.addEventListener('click', retry);
}
