import { fmt, status } from '../domain/dates';
import type { DateStr } from '../domain/dates';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ENT[c]);

export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

export function pill(d: DateStr, today: DateStr, big = false): string {
  const st = status(d, today);
  const label = st === 'expired' ? `Best before ${fmt(d)}, past date` : `Best before ${fmt(d)}`;
  return `<span class="date ${st}${big ? ' big' : ''}" aria-label="${label}">${fmt(d)}</span>`;
}

export function row(o: { act: string; pid?: string; name: string; sub?: string; right: string; cls?: string }): string {
  return `<button class="row ${o.cls ?? ''}" data-act="${o.act}" data-v="${esc(o.pid ?? '')}">
    <span><span class="name">${esc(o.name)}</span>${o.sub ? `<span class="sub">${o.sub}</span>` : ''}</span>
    <span class="right">${o.right}</span></button>`;
}

export function stepper(act: string, value: number, min: number, max: number, label: string, extra = ''): string {
  return `<div class="stepper" role="group" aria-label="${esc(label)}">
    <button data-act="${act}" data-v="-1" ${extra} aria-label="Fewer" ${value <= min ? 'disabled' : ''}>−</button>
    <output>${value}</output>
    <button data-act="${act}" data-v="1" ${extra} aria-label="More" ${value >= max ? 'disabled' : ''}>+</button></div>`;
}

export function head(title: string): string {
  return `<div class="grabber"></div><div class="sheet-head"><h2>${esc(title)}</h2><button class="close" data-act="close" aria-label="Close">×</button></div>`;
}
