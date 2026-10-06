// Event Passport: a stamp for every kind of event you take part in; collections unlock titles,
// badges and diamonds. passportCardHtml() is a card any screen can show (the Profile tab, the
// Events tab); tapping it opens the full passport.
import { H, esc, screen } from '../host';
import { icons } from '../../ui/icons';
import { sfx } from '../../audio';
import type { Profile } from '../../state';
import { COLLECTIONS, STAMPS, claimCollection, collectionProgress, rewardText, stamps } from './store';

/**
 * The passport as a card. Put it in the Profile tab's HTML: `${passportCardHtml()}`.
 * No binding needed: a tap on it opens the passport (index.ts listens for [data-ev-passport]).
 * `back` is the tab to return to ('you' from the Profile, 'events' from Events).
 */
export function passportCardHtml(p: Profile = H().profile(), back: 'you' | 'events' = 'you') {
  const s = stamps(p);
  const got = STAMPS.filter((x) => (s[x.id] ?? 0) > 0).length;
  const ready = COLLECTIONS.filter((c) => { const st = collectionProgress(p, c); return st.ready && !st.claimed; }).length;
  return `<button class="card ev-passport-card" data-ev-passport="${back}">
    <div class="row"><span class="ev-pp-ico">${icons.stamp}</span><span class="grow"><b>Event Passport</b><span class="muted small">${got} of ${STAMPS.length} stamps${ready ? ` · <em class="ev-ready">${ready} reward${ready === 1 ? '' : 's'} ready</em>` : ''}</span></span>${icons.arrow}</div>
    <div class="ev-stamps mini">${STAMPS.map((x) => `<span class="ev-stamp${(s[x.id] ?? 0) > 0 ? ' on' : ''}" title="${esc(x.label)}">${x.icon}</span>`).join('')}</div>
  </button>`;
}

export function passportScreen(back: () => void) {
  const h = H();
  const p = h.profile();
  const s = stamps(p);
  screen(`
    <p class="kicker">${icons.stamp} Events</p>
    <h1 class="title">Event Passport</h1>
    <p class="muted">A stamp for every kind of event you take part in. Complete a collection for its reward.</p>
    <div class="card ev-pp">
      <div class="ev-stamps">${STAMPS.map((x) => `<div class="ev-stamp-big${(s[x.id] ?? 0) > 0 ? ' on' : ''}"><span class="ev-stamp">${x.icon}</span><b>${esc(x.label)}</b><small>${(s[x.id] ?? 0) > 0 ? `${s[x.id]}×` : 'Not yet'}</small></div>`).join('')}</div>
    </div>
    <h2 class="ev-h2">Collections</h2>
    <div class="stack">${COLLECTIONS.map((c) => {
      const st = collectionProgress(p, c);
      return `<div class="card ev-coll${st.claimed ? ' claimed' : st.ready ? ' ready' : ''}">
        <div class="row"><b class="grow">${esc(c.name)}</b><span class="muted small">${st.got} / ${st.of}</span></div>
        <p class="muted small">${esc(c.hint)}</p>
        <div class="xpbar"><div style="width:${(st.got / st.of) * 100}%"></div></div>
        <div class="row small"><span>${icons.gift} ${esc(rewardText(c.reward))}</span><span class="grow"></span>${st.claimed ? `<span class="badge">${icons.check} Claimed</span>` : st.ready ? `<button class="btn btn-primary btn-sm" data-claim="${c.id}">Claim</button>` : ''}</div>
      </div>`;
    }).join('')}</div>
  `, back);
  h.app.querySelectorAll<HTMLElement>('[data-claim]').forEach((b) => b.addEventListener('click', () => {
    if (claimCollection(p, b.dataset.claim!)) sfx.finish();
    passportScreen(back);
  }));
}

