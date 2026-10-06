// Challenge admin (only for riders in the admins table; the server checks is_admin() on every call):
// fees and limits, routes and formats on or off, reports, removing challenges, banning creators.
import { icons } from '../../ui/icons';
import { H, esc, fmt, on, screen } from '../host';
import * as api from './api';
import { CH_ROUTES, FORMATS, whenText, type ChallengeConfig, type Format } from './model';
import { byline } from './view';

export async function adminScreen(back: () => void = () => H().home('challenges')) {
  const cfg: ChallengeConfig = { ...(await api.loadConfig()) };
  const num = (id: keyof ChallengeConfig, label: string, hint: string) => `<div class="field"><label for="ad_${id}">${label}</label><input id="ad_${id}" type="number" inputmode="numeric" min="0" value="${cfg[id] as number}"><small class="muted">${hint}</small></div>`;
  screen(`
    <p class="kicker">${icons.shield} Admin</p>
    <h1 class="title">Challenge settings</h1>
    <div class="card stack">
      <b>Fees and limits</b>
      <div class="chx-admin-grid">
        ${num('creationFee', 'Creation fee (coins)', 'Paid by the creator. Not part of prizes.')}
        ${num('entryMin', 'Lowest entry fee', 'For paid challenges.')}
        ${num('entryMax', 'Highest entry fee', '')}
        ${num('maxPool', 'Biggest prize pool', 'Entry × riders can’t be more.')}
        ${num('maxRiders', 'Most riders', '2 to 10.')}
        ${num('perDay', 'Challenges per rider per day', 'Stops spam.')}
        ${num('officialBonus', 'Official first-finish bonus', 'Coins for finishing an official challenge.')}
      </div>
    </div>
    <div class="card stack">
      <b>Routes</b>
      <div class="chx-chips">${CH_ROUTES.map((r) => `<button class="chip-btn${cfg.disabledRoutes.includes(r.id) ? '' : ' on'}" data-adroute="${r.id}">${esc(r.name)}</button>`).join('')}</div>
      <b>Formats</b>
      <div class="chx-chips">${FORMATS.filter((f) => !f.soon).map((f) => `<button class="chip-btn${cfg.disabledFormats.includes(f.id) ? '' : ' on'}" data-adformat="${f.id}">${esc(f.name)}</button>`).join('')}</div>
      <p class="muted small">Highlighted = allowed in new challenges.</p>
    </div>
    <button class="btn btn-primary" id="adSave">Save settings</button>
    <h2 class="chx-sec-h">${icons.alert} Reports</h2>
    <div class="card" id="adReports"><p class="muted small">Loading…</p></div>
    <h2 class="chx-sec-h">${icons.flag} Recent challenges</h2>
    <div class="card" id="adRecent"><p class="muted small">Loading…</p></div>
  `, back, 'chx-screen');
  on('[data-adroute]', 'click', (_, el) => {
    const id = el.dataset.adroute!;
    cfg.disabledRoutes = cfg.disabledRoutes.includes(id) ? cfg.disabledRoutes.filter((x) => x !== id) : [...cfg.disabledRoutes, id];
    el.classList.toggle('on');
  });
  on('[data-adformat]', 'click', (_, el) => {
    const id = el.dataset.adformat as Format;
    cfg.disabledFormats = cfg.disabledFormats.includes(id) ? cfg.disabledFormats.filter((x) => x !== id) : [...cfg.disabledFormats, id];
    el.classList.toggle('on');
  });
  on('#adSave', 'click', async (_, el) => {
    for (const k of ['creationFee', 'entryMin', 'entryMax', 'maxPool', 'maxRiders', 'perDay', 'officialBonus'] as const) {
      const v = Math.max(0, Math.round(Number(H().app.querySelector<HTMLInputElement>(`#ad_${k}`)!.value) || 0));
      cfg[k] = v;
    }
    cfg.maxRiders = Math.min(10, Math.max(2, cfg.maxRiders));
    if (cfg.entryMax < cfg.entryMin) return H().toast('The highest entry fee must be at least the lowest.');
    (el as HTMLButtonElement).disabled = true;
    const r = await api.saveConfig(cfg);
    (el as HTMLButtonElement).disabled = false;
    H().toast(r.ok ? `${icons.check} Saved. New challenges use these settings.` : esc(r.message));
  });
  const reportsBox = H().app.querySelector<HTMLElement>('#adReports')!;
  const loadReports = async () => {
    const r = await api.reports();
    if (!r.ok) { reportsBox.innerHTML = `<p class="muted small">${esc(r.message)}</p>`; return; }
    reportsBox.innerHTML = r.data.length ? r.data.map((x) => `<div class="chx-adrow">
      <span class="grow"><b>${esc(x.name)}</b><small class="muted">${esc(x.reason)} · reported by ${esc(x.by)} · ${esc(whenText(x.at))}</small></span>
      <button class="btn btn-ghost btn-sm" data-adremove="${esc(x.challenge)}">Remove</button>
      ${x.creator ? `<button class="btn btn-ghost btn-sm" data-adban="${esc(x.creator)}">Ban creator</button>` : ''}
      <button class="btn btn-link btn-sm" data-addismiss="${x.id}">Dismiss</button>
    </div>`).join('') : '<p class="muted small">No open reports.</p>';
  };
  const recentBox = H().app.querySelector<HTMLElement>('#adRecent')!;
  const loadRecent = async () => {
    const r = await api.adminRecent();
    if (!r.ok) { recentBox.innerHTML = `<p class="muted small">${esc(r.message)}</p>`; return; }
    recentBox.innerHTML = r.data.length ? r.data.map((c) => `<div class="chx-adrow">
      <span class="grow"><b>${esc(c.name)}</b><small class="muted">${byline(c)} · ${c.riders} riders · ${c.entryFee ? `${fmt(c.entryFee)} entry` : 'free'} · ${esc(c.status)}</small></span>
      ${c.status === 'removed' || c.status === 'cancelled' ? '' : `<button class="btn btn-ghost btn-sm" data-adremove="${esc(c.id)}">Remove</button>`}
      ${c.creator ? `<button class="btn btn-ghost btn-sm" data-adban="${esc(c.creator.id)}">Ban creator</button>` : ''}
    </div>`).join('') : '<p class="muted small">No rider challenges yet.</p>';
  };
  // one listener for the rows (they are redrawn)
  H().app.querySelector('.chx-screen')!.addEventListener('click', async (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-adremove],[data-adban],[data-addismiss]');
    if (!el) return;
    if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = 'Tap again'; return; }
    const r = el.dataset.adremove ? await api.adminRemove(el.dataset.adremove, 'Removed by an admin')
      : el.dataset.adban ? await api.adminBan(el.dataset.adban, 'Banned by an admin', 30)
      : await api.adminDismiss(Number(el.dataset.addismiss));
    H().toast(r.ok ? `${icons.check} Done.${el.dataset.adremove ? ' Entry fees are refunded.' : el.dataset.adban ? ' They can’t create challenges for 30 days.' : ''}` : esc(r.message));
    void loadReports();
    void loadRecent();
  });
  void loadReports();
  void loadRecent();
}
