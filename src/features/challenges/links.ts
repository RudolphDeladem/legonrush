// Ways into a challenge from outside the tab: an invite link (?ch=LR-7K29X or ?ch=off-...), and the
// leaderboard button on the results screen.
import { H } from '../host';
import { cleanCode, officialById } from './model';
import { find } from './data';
import { boardScreen, codeScreen, detailScreen } from './screens';

export function openChallengeLink(raw: string) {
  const id = raw.trim();
  const home = () => H().home('challenges');
  if (id.startsWith('off-')) {
    const c = find(id) ?? officialById(id);
    if (c) return detailScreen(c, home);
  }
  codeScreen(home, cleanCode(id) ?? '');
}

// the results screen's "Challenge leaderboard" button (its HTML comes from ride.ts)
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest?.<HTMLElement>('[data-chx-board]');
  if (!b) return;
  const c = find(b.dataset.chxBoard!) ?? officialById(b.dataset.chxBoard!);
  if (c) boardScreen(c, () => H().home('challenges'));
});
