// The app shell: header, list, tabs, sheets, toasts. A port of docs/prototype.html,
// reading state from a Store and sending every change through it.
import { canDeleteCupboard, checkCupboardName } from '../domain/actions';
import type { RotatePick } from '../domain/actions';
import { MONTHS, fmt, ym, ymOf } from '../domain/dates';
import type { DateStr } from '../domain/dates';
import {
  addCupboardOrder, addItems, backTarget, clamp, cupboardsWithStock, defaultAddCupboard, defaultAddDate,
  describeSteps, front, homeItems, lotsFor, plan, reserveLots, rotationNeeds, shopItems, stockIn, sumQty,
  swapNeeds, total, useItems,
} from '../domain/inventory';
import type { Product, State } from '../domain/types';
import type { Store, UndoToken } from '../store/store';
import { esc, head, pill, plural, row, stepper } from './html';

export type Tab = 'home' | 'use' | 'shop' | 'add';

const TITLES: Record<Tab, string> = { home: 'In the cupboards', use: 'Use something', shop: 'Running low', add: 'Add shopping' };
const PLACEHOLDERS: Record<Tab, string> = { home: 'Search', use: 'What are you using?', shop: 'Search', add: 'Type to find or add' };

type SheetKind = 'add' | 'use' | 'detail' | 'rotate' | 'loc-new' | 'loc-edit' | 'settings';
interface Sheet {
  kind: SheetKind;
  pid?: string | null;
  // add
  name?: string;
  target?: number;
  qty?: number;
  y?: number;
  m?: number | null;
  loc?: string;
  // detail / rotate
  picks?: Record<string, RotatePick> | null;
}

/** What the shell knows about who's signed in, for the settings sheet. */
export interface Env {
  demo: boolean;
  household?: { id: string; name: string };
  email?: string | null;
  signOut?: () => void;
  switchHousehold?: () => void;
  deviceName: () => string;
  setDeviceName: (n: string) => void;
  /** Per-household localStorage. */
  get: (k: string) => string | null;
  set: (k: string, v: string | null) => void;
}

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

export function startApp(store: Store, env: Env): void {
  let s: State = store.current!;
  const ui: { tab: Tab; loc: string | null; q: string } = { tab: 'home', loc: null, q: '' };
  let sheet: Sheet | null = null;
  let lastDateThisSession: DateStr | null = null;
  let skipSheetAnim = false;
  let addDraft: Sheet | null = null;

  const now = () => new Date();
  const today = () => ymOf(now());
  const thisY = () => now().getFullYear();
  const thisM = () => now().getMonth() + 1;
  const cn = (id: string) => s.cupboards.names[id] ?? id;
  const cupboards = () => s.cupboards.order;
  const product = (pid: string | null | undefined): Product | undefined => (pid ? s.products[pid] : undefined);
  const keptIn = (p: Product) => `kept in ${esc(p.cupboards.map(cn).join(', then '))}`;

  // ---------- toast ----------
  let undoToken: UndoToken | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toast(msg: string, token: UndoToken | null) {
    undoToken = token;
    $('#toast-msg').textContent = msg;
    $('#toast').querySelector('button')!.hidden = !token;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $('#toast').hidden = true;
      undoToken = null;
    }, 6000);
  }
  /** Toast with Undo after a change, as the prototype does (changes without a message get none). */
  function done(token: UndoToken | null) {
    if (token?.message) toast(token.message, token);
  }
  store.onError((e) => {
    const code = (e as { code?: string }).code ?? '';
    const msg = code === 'permission-denied'
      ? 'Couldn’t save: this account no longer has access.'
      : `Couldn’t save that change${code ? ` (${code})` : ''}.`;
    toast(msg, null);
  });

  // ---------- list ----------
  function render() {
    if (ui.loc && !cupboards().includes(ui.loc)) ui.loc = null;
    document.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.setAttribute('aria-current', b.dataset.v === ui.tab ? 'page' : 'false'));
    $('#title').textContent = TITLES[ui.tab];
    $('#gear').hidden = ui.tab !== 'home';
    const q = $<HTMLInputElement>('#q');
    q.placeholder = PLACEHOLDERS[ui.tab];
    if (q.value !== ui.q) q.value = ui.q;
    $('#locs').innerHTML = [null, ...cupboards()].map((l) =>
      `<button class="chip" data-act="loc" data-v="${esc(l ?? '')}" aria-pressed="${ui.loc === l}">${esc(l ? cn(l) : 'All')}</button>`).join('')
      + `<button class="chip add-loc" data-act="new-loc" aria-label="Add a cupboard">+</button>`;
    renderList();
  }

  function renderList() {
    let html = '';
    let count = '';
    const where = ui.loc ? ` in ${cn(ui.loc)}` : '';
    const td = today();
    if (ui.tab === 'home' || ui.tab === 'use') {
      const items = ui.tab === 'home' ? homeItems(s, ui.q, ui.loc) : useItems(s, ui.q, ui.loc);
      const n = items.reduce((t, x) => t + x.qty, 0);
      count = n ? plural(n, 'item') : '';
      html = items.map(({ p, lots, qty }) => {
        const sub = ui.tab === 'use'
          ? `Take from ${esc(cn(lots[0].cupboard))}`
          : ui.loc ? '' : esc(cupboardsWithStock(p, lots).map(cn).join(', '));
        return row({ act: ui.tab === 'use' ? 'open-use' : 'open-detail', pid: p.id, name: p.name, sub,
          right: `${pill(lots[0].date, td)}<span class="qty">${qty}</span>` });
      }).join('');
      if (!items.length) {
        if (ui.q) html = `<p class="empty">No “${esc(ui.q)}”${esc(where)}.</p>`;
        else if (ui.tab === 'home') html = `<p class="empty">Nothing${esc(where)} yet. Use Add to stock it.</p>`;
        else html = `<p class="empty">Nothing in stock${esc(where)}.</p>`;
      }
      if (ui.tab === 'home') {
        const needs = ui.q ? [] : rotationNeeds(s);
        if (needs.length) {
          html = row({ act: 'open-rotate', name: 'Rotate stock', cls: 'rotate-row',
            sub: `${needs.length} item${needs.length === 1 ? ' has' : 's have'} older stock in reserve`,
            right: '<span class="plus" aria-hidden="true">↻</span>' }) + html;
        }
      }
    } else if (ui.tab === 'shop') {
      const items = shopItems(s, ui.q, ui.loc);
      count = items.length ? `${items.length} to buy` : '';
      html = items.map(({ p, have, buy }) => row({ act: 'open-detail', pid: p.id, name: p.name,
        sub: `Have ${have} of ${p.target}`, right: `<span class="buy">Buy ${buy}</span>` })).join('');
      if (!items.length) html = `<p class="empty">Nothing running low${esc(where)}. Set a target on any item to track it here.</p>`;
    } else {
      const q = ui.q.trim();
      const { items, exact } = addItems(s, ui.q);
      // Matches first; the "new item" row goes last so a quick tap on the top row picks an existing item.
      html += items.map((p) => {
        const have = total(s, p.id);
        return row({ act: 'open-add', pid: p.id, name: p.name,
          sub: `${have ? `${have} in stock` : 'None in stock'}, ${keptIn(p)}`,
          right: '<span class="plus" aria-hidden="true">+</span>' });
      }).join('');
      if (q && !exact) html += row({ act: 'open-new', name: `Add “${q}”`, sub: 'New item', right: '<span class="plus" aria-hidden="true">+</span>', cls: 'new' });
      if (!html) html = `<p class="empty">Type a name to add your first item.</p>`;
    }
    $('#count').textContent = count;
    $('#list').innerHTML = html;
  }

  // ---------- sheets ----------
  function openSheet(sh: Sheet) {
    sheet = sh;
    renderSheet();
  }
  function closeSheet() {
    sheet = null;
    $('#sheet').hidden = true;
    $('#sheet').innerHTML = '';
  }

  function addLabel(): string {
    if (!sheet!.m) return 'Pick a month';
    if (!sheet!.pid && !sheet!.name!.trim()) return 'Type a name';
    return `Add ${sheet!.qty} to ${cn(sheet!.loc!)}`;
  }

  function addSheet(sh: Sheet): string {
    const p = product(sh.pid);
    const isNew = !p;
    const ty = thisY();
    const tm = thisM();
    const years = Array.from({ length: 6 }, (_, i) => ty + i);
    const ready = sh.m && (isNew ? sh.name!.trim() : true);
    let h = head(isNew ? 'New item' : p.name);
    if (isNew) h += `<label class="field"><h3>Name</h3><input id="newname" value="${esc(sh.name)}" autocomplete="off"></label>`;
    h += `<h3>Best before</h3><div class="years">${years.map((y) =>
      `<button class="chip" data-act="year" data-v="${y}" aria-pressed="${sh.y === y}">${y}</button>`).join('')}</div>`;
    h += `<div class="months">${MONTHS.map((m, i) => {
      const past = sh.y === ty && i + 1 < tm;
      return `<button class="chip" data-act="month" data-v="${i + 1}" aria-pressed="${sh.m === i + 1}" ${past ? 'disabled' : ''}>${m}</button>`;
    }).join('')}</div>`;
    h += `<div class="pair"><div><h3>How many</h3>${stepper('qty', sh.qty!, 1, 99, 'How many')}</div>`;
    if (isNew) h += `<div><h3>Keep at least</h3>${stepper('target', sh.target!, 0, 99, 'Keep at least')}</div>`;
    h += `</div><h3>Cupboard</h3><div class="chips wrap">${addCupboardOrder(s, p ?? null).map((l) =>
      `<button class="chip" data-act="sloc" data-v="${esc(l)}" aria-pressed="${sh.loc === l}">${esc(cn(l))}</button>`).join('')}</div>`;
    h += `<button class="primary" data-act="save-add" ${ready ? '' : 'disabled'}>${esc(addLabel())}</button>`;
    return h;
  }

  function useSheet(sh: Sheet, p: Product): string | null {
    const lots = lotsFor(s, p.id, ui.loc);
    if (!lots.length) return null;
    const have = sumQty(lots);
    sh.qty = clamp(sh.qty ?? 1, 1, have);
    const first = lots[0];
    let h = head(p.name);
    h += `<div class="take"><p>Take the one dated</p>${pill(first.date, today(), true)}<p class="where">from ${esc(cn(first.cupboard))}</p></div>`;
    h += `<div class="center">${stepper('uqty', sh.qty, 1, have, 'How many to take')}</div>`;
    const left = have - sh.qty;
    h += `<p class="after">${left === 0 ? 'That’s the last one' : `${left} left after this`}${ui.loc ? ` in ${esc(cn(ui.loc))}` : ''}.</p>`;
    if (lots.length > 1) {
      h += `<p class="others">Also: ${lots.slice(1).map((l) => `${fmt(l.date)} ×${l.qty} (${esc(cn(l.cupboard))})`).join(', ')}</p>`;
    }
    h += `<button class="primary" data-act="confirm-use">Take ${sh.qty}</button>`;
    return h;
  }

  function describe(steps: ReturnType<typeof plan<import('../domain/types').Lot>>): string {
    return describeSteps(steps).map((g) => `${fmt(g.date)} ×${g.n} from ${esc(cn(g.cupboard))}`).join(', ');
  }

  /** Make sure a pick is within what's possible now (stock may have changed on another phone). */
  function fitPick(p: Product, pick: RotatePick) {
    const n = swapNeeds(s, p);
    pick.f = clamp(pick.f, 0, n.rTotal);
    pick.r = clamp(pick.r, 0, n.fTotal);
  }

  function swapRow(p: Product, pick: RotatePick, withCheckbox: boolean): string {
    fitPick(p, pick);
    const n = swapNeeds(s, p);
    const fc = front(p)!;
    const reserve = reserveLots(s, p);
    const newestFirst = [...lotsFor(s, p.id, fc)].reverse();
    const back = backTarget(s, p) ?? fc;
    const st = (k: 'f' | 'r', val: number, max: number, what: string) => `<div class="stepper" role="group" aria-label="How many ${esc(p.name)} ${esc(what)}">
    <button data-act="swapn" data-k="${k}" data-v="-1" data-pid="${p.id}" aria-label="Fewer" ${val <= 0 ? 'disabled' : ''}>−</button>
    <output>${val}</output>
    <button data-act="swapn" data-k="${k}" data-v="1" data-pid="${p.id}" aria-label="More" ${val >= max ? 'disabled' : ''}>+</button></div>`;
    let h = withCheckbox ? `<label class="toggle"><input type="checkbox" data-rotpid="${p.id}" ${pick.on ? 'checked' : ''}>${esc(p.name)}</label>` : '';
    h += `<div class="line">${st('f', pick.f, n.rTotal, `oldest to ${cn(fc)}`)}<span>oldest to ${esc(cn(fc))}</span></div>`;
    if (pick.f) h += `<p class="preview">${describe(plan(reserve, pick.f))}</p>`;
    if (n.fTotal) {
      h += `<div class="line">${st('r', pick.r, n.fTotal, `newest to ${cn(back)}`)}<span>newest to ${esc(cn(back))}</span></div>`;
      if (pick.r) h += `<p class="preview">${describe(plan(newestFirst, pick.r))}</p>`;
    }
    return h;
  }

  function swapLabel(p: Product, pick: RotatePick): string {
    const fc = cn(front(p)!);
    const back = cn(backTarget(s, p) ?? front(p)!);
    if (pick.f && pick.r) return `Swap: ${pick.f} to ${fc}, ${pick.r} to ${back}`;
    if (pick.f) return `Move ${pick.f} to ${fc}`;
    if (pick.r) return `Move ${pick.r} to ${back}`;
    return 'Nothing to move';
  }

  function detailSheet(sh: Sheet, p: Product): string {
    const td = today();
    const lots = lotsFor(s, p.id);
    const have = sumQty(lots);
    const rTotal = sumQty(reserveLots(s, p));
    let h = head(p.name);
    h += `<p class="lede">${have ? `${have} in stock` : 'None in stock'}</p>`;
    if (lots.length) {
      h += `<h3>Stock</h3><ul class="lots">${lots.map((l) => `<li>${pill(l.date, td)}
        <select data-lot="${esc(l.id)}" aria-label="Cupboard for ${fmt(l.date)}">${cupboards().map((c) =>
          `<option value="${esc(c)}" ${c === l.cupboard ? 'selected' : ''}>${esc(cn(c))}</option>`).join('')}</select>
        <span class="qty">${l.qty}</span>
        <button class="dec" data-act="lot-dec" data-v="${esc(l.id)}" aria-label="Remove one dated ${fmt(l.date)}">−</button></li>`).join('')}</ul>`;
    }
    if (rTotal && p.cupboards.length) {
      if (!sh.picks || !sh.picks[p.id]) {
        const n = swapNeeds(s, p);
        sh.picks = { [p.id]: { on: true, f: n.f, r: n.r } };
      }
      const pick = sh.picks[p.id];
      const rowHtml = swapRow(p, pick, false);
      h += `<div class="rotate rot-list"><h3 class="flush">Rotate</h3>${rowHtml}
        <button class="secondary" data-act="do-swap" ${pick.f || pick.r ? '' : 'disabled'}>${esc(swapLabel(p, pick))}</button></div>`;
    }
    h += `<h3>Cupboards, front first</h3><ol class="order">${p.cupboards.map((l, i) => {
      const hasStock = lots.some((x) => x.cupboard === l);
      const name = cn(l);
      return `<li><span class="${i === 0 ? 'first' : ''}">${esc(name)}<span class="hint">${i === 0 ? 'Take from here' : 'Reserve'}</span></span>
        <button data-act="ord-up" data-v="${esc(l)}" aria-label="Move ${esc(name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button data-act="ord-down" data-v="${esc(l)}" aria-label="Move ${esc(name)} down" ${i === p.cupboards.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-act="ord-rm" data-v="${esc(l)}" aria-label="Remove ${esc(name)}" ${hasStock || p.cupboards.length === 1 ? 'disabled' : ''}>×</button></li>`;
    }).join('')}</ol>`;
    const spare = cupboards().filter((l) => !p.cupboards.includes(l));
    if (spare.length) {
      h += `<select class="addloc" data-addloc="1" aria-label="Add a cupboard"><option value="">Add a cupboard…</option>${
        spare.map((l) => `<option value="${esc(l)}">${esc(cn(l))}</option>`).join('')}</select>`;
    }
    h += `<h3>Keep at least</h3>${stepper('dtarget', p.target, 0, 99, 'Keep at least')}`;
    h += `<button class="primary" data-act="open-add" data-v="${esc(p.id)}">Add more</button>`;
    if (!have) h += `<button class="text-btn" data-act="delete-product">Delete this item</button>`;
    return h;
  }

  function rotateSheet(sh: Sheet): string {
    const picks = sh.picks!;
    for (const id of Object.keys(picks)) if (!product(id)) delete picks[id];
    const ids = Object.keys(picks);
    const chosen = ids.filter((id) => picks[id].on && (picks[id].f || picks[id].r)).length;
    let h = head('Rotate stock') + `<p class="lede">Bring the oldest forward and send the newest back. Both start at the number in the wrong place.</p><ul class="rot-list">`;
    for (const id of ids) {
      const pick = picks[id];
      h += `<li class="${pick.on ? '' : 'off'}">${swapRow(product(id)!, pick, true)}</li>`;
    }
    h += `</ul><button class="primary" data-act="do-rotate" ${chosen ? '' : 'disabled'}>${chosen ? `Rotate ${plural(chosen, 'item')}` : 'Nothing selected'}</button>`;
    return h;
  }

  function locSheet(sh: Sheet): string {
    const input = `<label class="field"><h3>Name</h3><input id="locname" value="${esc(sh.name)}" autocomplete="off" maxlength="24" enterkeyhint="done"></label>`;
    if (sh.kind === 'loc-new') {
      const c = checkCupboardName(s.cupboards, sh.name!, null);
      return head('New cupboard') + input
        + `<p class="note">Press and hold a cupboard in the top bar to rename or delete it.</p>`
        + `<button class="primary" data-act="save-loc" ${c.ok ? '' : 'disabled'}>${esc(c.msg)}</button>`;
    }
    const id = sh.loc!;
    const n = stockIn(s, id);
    const c = checkCupboardName(s.cupboards, sh.name!, id);
    let h = head(cn(id)) + `<p class="lede">${n ? `${plural(n, 'item')} in here` : 'Empty'}</p>` + input
      + `<button class="primary" data-act="rename-loc" ${c.ok ? '' : 'disabled'}>${esc(c.msg)}</button>`;
    if (cupboards().length === 1) h += `<p class="note">This is your only cupboard, so it can’t be deleted.</p>`;
    else if (n) h += `<p class="note">To delete this cupboard, move or use the ${plural(n, 'item')} in it first.</p>`;
    else if (canDeleteCupboard(s, id)) h += `<button class="text-btn danger" data-act="delete-loc">Delete ${esc(cn(id))}</button>`;
    return h;
  }

  function settingsSheet(): string {
    let h = head('Settings');
    h += `<dl class="kv">`;
    if (env.household) h += `<div><dt>Household</dt><dd>${esc(env.household.name)}</dd></div>`;
    if (env.email) h += `<div><dt>Signed in as</dt><dd>${esc(env.email)}</dd></div>`;
    if (env.demo) h += `<div><dt>Mode</dt><dd>Demo: nothing is saved</dd></div>`;
    h += `</dl>`;
    h += `<label class="field"><h3>Who’s this phone?</h3><input id="devname" value="${esc(env.deviceName())}" placeholder="e.g. Sam’s phone" autocomplete="off" maxlength="30" enterkeyhint="done"></label>`;
    h += `<p class="note">Shown in the change history, since a household may share one Google account.</p>`;
    h += `<button class="secondary" data-act="export">Export JSON</button>`;
    h += `<p class="note">A backup of everything in this household.</p>`;
    if (env.switchHousehold) h += `<button class="secondary" data-act="switch-household">Switch household</button>`;
    if (env.signOut) h += `<button class="text-btn danger" data-act="sign-out">Sign out</button>`;
    return h;
  }

  function renderSheet() {
    if (!sheet) return;
    let h: string | null = '';
    const p = product(sheet.pid);
    // The item may have been deleted on another phone.
    if (sheet.pid && !p) { closeSheet(); return; }
    switch (sheet.kind) {
      case 'add': h = addSheet(sheet); break;
      case 'use': h = useSheet(sheet, p!); break;
      case 'detail': h = detailSheet(sheet, p!); break;
      case 'rotate': h = rotateSheet(sheet); break;
      case 'loc-new': case 'loc-edit':
        if (sheet.kind === 'loc-edit' && !cupboards().includes(sheet.loc!)) { closeSheet(); return; }
        h = locSheet(sheet); break;
      case 'settings': h = settingsSheet(); break;
    }
    if (h === null) { closeSheet(); return; }
    const old = document.querySelector<HTMLElement>('#sheet .panel');
    const scroll = old ? old.scrollTop : 0;
    // Slide up only when the sheet first opens, not on every re-render inside it.
    const anim = !old && !skipSheetAnim;
    skipSheetAnim = false;
    $('#sheet').innerHTML = `<div class="panel${anim ? ' anim' : ''}" role="dialog" aria-modal="true">${h}</div>`;
    placeSheet();
    $('#sheet').hidden = false;
    $('#sheet .panel').scrollTop = scroll;
    if (sheet.kind === 'loc-new' && !old) $<HTMLInputElement>('#locname')?.focus();
  }

  // Sheets sit above the tab bar so the tabs stay usable while an item is open.
  function placeSheet() {
    const r = $('nav').getBoundingClientRect();
    document.documentElement.style.setProperty('--sheet-bottom', `${Math.max(0, window.innerHeight - r.top)}px`);
  }
  window.addEventListener('resize', () => { if (sheet) placeSheet(); });

  function refreshLocButton() {
    const b = document.querySelector<HTMLButtonElement>('[data-act="save-loc"], [data-act="rename-loc"]');
    if (!b || !sheet) return;
    const c = checkCupboardName(s.cupboards, sheet.name!, sheet.kind === 'loc-edit' ? sheet.loc! : null);
    b.disabled = !c.ok;
    b.textContent = c.msg;
  }

  // An unsaved Add sheet (date picked etc.) survives a trip to another tab and back.
  function openForTab(pid: string) {
    if (!product(pid)) return;
    if (ui.tab === 'add') {
      if (addDraft && addDraft.pid === pid) openSheet({ ...addDraft });
      else startAdd(pid);
    } else if (ui.tab === 'use' && total(s, pid, ui.loc) > 0) {
      openSheet({ kind: 'use', pid, qty: 1 });
    } else {
      openSheet({ kind: 'detail', pid });
    }
  }

  const LAST_ADD = 'lastAddCupboard';
  function startAdd(pid: string | null, name?: string) {
    const p = product(pid) ?? null;
    const d = defaultAddDate(p, lastDateThisSession, today());
    sheet = null;
    const loc = defaultAddCupboard(s, p, ui.loc, env.get(LAST_ADD));
    openSheet({ kind: 'add', pid: p ? p.id : null, name: name ?? '', target: 2, qty: 1, y: d.y, m: d.m, loc });
  }

  // ---------- store updates (ours and the other phone's) ----------
  store.subscribe((next) => {
    s = next;
    render();
    if (!sheet) return;
    // Don't yank an input someone is typing in; the next local action re-renders the sheet anyway.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.closest('#sheet')) return;
    renderSheet();
  });

  // ---------- events ----------
  $('#q').addEventListener('input', (e) => { ui.q = (e.target as HTMLInputElement).value; renderList(); });
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!sheet) return;
    if (t.id === 'locname') { sheet.name = t.value; refreshLocButton(); return; }
    if (t.id === 'devname') { env.setDeviceName(t.value.trim()); return; }
    if (t.id === 'newname') {
      sheet.name = t.value;
      const b = document.querySelector<HTMLButtonElement>('[data-act="save-add"]');
      if (b) { b.disabled = !(sheet.m && sheet.name.trim()); b.textContent = addLabel(); }
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.dataset.rotpid && sheet?.picks) {
      sheet.picks[t.dataset.rotpid].on = (t as HTMLInputElement).checked;
      renderSheet();
      return;
    }
    if (t.dataset.addloc && sheet) {
      if (t.value) {
        const c = t.value;
        sheet.picks = null;
        done(store.addProductCupboard(sheet.pid!, c));
        renderSheet();
      }
      return;
    }
    const id = t.dataset.lot;
    if (!id) return;
    const to = t.value;
    if (sheet) sheet.picks = null;
    done(store.moveLot(id, to));
    renderSheet();
  });
  $('#sheet').addEventListener('click', (e) => { if ((e.target as HTMLElement).id === 'sheet') closeSheet(); });
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape' && sheet) closeSheet();
    if (e.key === 'Enter' && t.id === 'locname') {
      const b = document.querySelector<HTMLButtonElement>('[data-act="save-loc"], [data-act="rename-loc"]');
      if (b && !b.disabled) b.click();
    }
    if (e.key === 'Enter' && t.id === 'devname') (t as HTMLInputElement).blur();
  });

  // Long-press (or right-click) a cupboard chip to rename or delete it.
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressFired = false;
  let pressStart: { x: number; y: number } | null = null;
  // After a long press, the finger lifting fires a click on whatever is now under it (the sheet's scrim),
  // which would close the sheet straight away. Swallow that one click.
  let suppressClickUntil = 0;
  document.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      pressFired = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
  // Is a finger (or the main mouse button) still down on a chip? Only then will a click follow the sheet opening.
  let held = false;
  function openLocEdit(loc: string) {
    pressFired = held;
    // A right-click has no follow-up click; swallowing one would eat the user's next real tap.
    suppressClickUntil = held ? Date.now() + 700 : 0;
    navigator.vibrate?.(10);
    openSheet({ kind: 'loc-edit', loc, name: cn(loc) });
  }
  const locs = $('#locs');
  locs.addEventListener('pointerdown', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-act="loc"]');
    pressFired = false;
    held = false;
    if (!chip || !chip.dataset.v || e.button !== 0) return;
    held = true;
    pressStart = { x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => openLocEdit(chip.dataset.v!), 500);
  });
  locs.addEventListener('pointermove', (e) => {
    if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) clearTimeout(pressTimer);
  });
  (['pointerup', 'pointercancel', 'pointerleave'] as const).forEach((ev) => locs.addEventListener(ev, () => {
    clearTimeout(pressTimer);
    // The click (if any) follows pointerup in the same task; keep `held` until then.
    setTimeout(() => { held = false; }, 0);
  }));
  locs.addEventListener('contextmenu', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-act="loc"]');
    if (!chip || !chip.dataset.v) return;
    e.preventDefault();
    clearTimeout(pressTimer);
    // Android Chrome fires contextmenu on a long press too; the timer may already have opened it.
    if (!sheet) openLocEdit(chip.dataset.v);
  });

  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const act = el.dataset.act!;
    const v = el.dataset.v ?? '';
    if (act === 'loc' && pressFired) { pressFired = false; return; }
    switch (act) {
      case 'tab': {
        // Keep the selected item when switching tabs: reopen it in the new tab's view.
        const pid = sheet && sheet.pid && ['add', 'use', 'detail'].includes(sheet.kind) ? sheet.pid : null;
        if (sheet && sheet.kind === 'add' && sheet.pid) addDraft = { ...sheet };
        ui.tab = v as Tab;
        closeSheet();
        render();
        $('#list').scrollTop = 0;
        if (pid) { skipSheetAnim = true; openForTab(pid); }
        break;
      }
      case 'loc': ui.loc = v || null; render(); break;
      case 'open-detail': openSheet({ kind: 'detail', pid: v }); break;
      case 'open-use': openSheet({ kind: 'use', pid: v, qty: 1 }); break;
      case 'open-add': startAdd(v); break;
      case 'open-new': startAdd(null, ui.q.trim()); break;
      case 'close': closeSheet(); break;
      case 'year':
        sheet!.y = +v;
        if (sheet!.y === thisY() && sheet!.m && sheet!.m < thisM()) sheet!.m = null;
        renderSheet();
        break;
      case 'month': sheet!.m = +v; renderSheet(); break;
      case 'qty': sheet!.qty = clamp(sheet!.qty! + +v, 1, 99); renderSheet(); break;
      case 'target': sheet!.target = clamp(sheet!.target! + +v, 0, 99); renderSheet(); break;
      case 'open-rotate': {
        const picks: Record<string, RotatePick> = {};
        for (const nd of rotationNeeds(s)) picks[nd.p.id] = { on: true, f: nd.f, r: nd.r };
        openSheet({ kind: 'rotate', picks });
        break;
      }
      case 'swapn': {
        const p = product(el.dataset.pid)!;
        const pick = sheet!.picks![p.id];
        const n = swapNeeds(s, p);
        const k = el.dataset.k as 'f' | 'r';
        pick[k] = clamp(pick[k] + +v, 0, k === 'f' ? n.rTotal : n.fTotal);
        renderSheet();
        break;
      }
      case 'do-swap': {
        const p = product(sheet!.pid)!;
        const pick = sheet!.picks![p.id];
        const tok = store.swap(p.id, pick.f, pick.r);
        sheet!.picks = null;
        done(tok);
        renderSheet();
        break;
      }
      case 'do-rotate': {
        const tok = store.rotate(sheet!.picks!);
        done(tok);
        closeSheet();
        render();
        break;
      }
      case 'uqty': sheet!.qty = Math.max(1, sheet!.qty! + +v); renderSheet(); break;
      case 'sloc': sheet!.loc = v; renderSheet(); break;
      case 'save-add': {
        const sh = sheet!;
        if (!sh.m) break;
        if (!sh.pid && !sh.name!.trim()) break;
        const date = ym(sh.y!, sh.m);
        const tok = store.addStock({ pid: sh.pid ?? null, name: sh.name, target: sh.target, cupboard: sh.loc!, date, qty: sh.qty! });
        lastDateThisSession = date;
        env.set(LAST_ADD, sh.loc!);
        addDraft = null;
        done(tok);
        closeSheet();
        render();
        break;
      }
      case 'confirm-use': {
        const tok = store.useStock(sheet!.pid!, sheet!.qty!, ui.loc);
        done(tok);
        closeSheet();
        render();
        break;
      }
      case 'ord-up': case 'ord-down': case 'ord-rm': {
        const p = product(sheet!.pid)!;
        const order = [...p.cupboards];
        const i = order.indexOf(v);
        if (i < 0) break;
        if (act === 'ord-rm') order.splice(i, 1);
        else {
          const j = act === 'ord-up' ? i - 1 : i + 1;
          if (j < 0 || j >= order.length) break;
          [order[i], order[j]] = [order[j], order[i]];
        }
        sheet!.picks = null;
        store.setCupboardOrder(p.id, order);
        renderSheet();
        break;
      }
      case 'lot-dec': {
        sheet!.picks = null;
        done(store.removeOne(v));
        renderSheet();
        break;
      }
      case 'dtarget': {
        const p = product(sheet!.pid)!;
        store.setTarget(p.id, clamp(p.target + +v, 0, 99));
        renderSheet();
        break;
      }
      case 'delete-product': {
        const p = product(sheet!.pid)!;
        done(store.deleteProduct(p.id));
        closeSheet();
        render();
        break;
      }
      case 'undo':
        if (undoToken) { store.undo(undoToken); undoToken = null; closeSheet(); render(); }
        $('#toast').hidden = true;
        break;
      case 'new-loc': openSheet({ kind: 'loc-new', name: '' }); break;
      case 'save-loc': {
        const n = sheet!.name!.trim();
        const tok = store.addCupboard(n);
        if (!tok) break;
        done(tok);
        closeSheet();
        render();
        break;
      }
      case 'rename-loc': {
        const to = sheet!.name!.trim();
        const tok = store.renameCupboard(sheet!.loc!, to);
        if (!tok) break;
        done(tok);
        closeSheet();
        render();
        break;
      }
      case 'delete-loc': {
        const id = sheet!.loc!;
        const tok = store.deleteCupboard(id);
        if (ui.loc === id) ui.loc = null;
        if (env.get(LAST_ADD) === id) env.set(LAST_ADD, null);
        done(tok);
        closeSheet();
        render();
        break;
      }
      case 'settings': openSheet({ kind: 'settings' }); break;
      case 'export': exportJSON(); break;
      case 'switch-household': env.switchHousehold?.(); break;
      case 'sign-out': env.signOut?.(); break;
    }
  });

  async function exportJSON() {
    const data = {
      app: 'cupboard',
      version: 1,
      exportedAt: new Date().toISOString(),
      household: env.household ?? null,
      cupboards: s.cupboards,
      products: Object.values(s.products),
      lots: Object.values(s.lots),
    };
    const name = `cupboard-${env.household?.id ?? 'demo'}-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    // iOS home-screen apps can't download; the share sheet can save to Files.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  $('#app').hidden = false;
  render();
}
