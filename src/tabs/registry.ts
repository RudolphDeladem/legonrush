// The menu tabs. Each tab lives in its own file under src/tabs/ and registers itself here;
// main.ts draws the shell (side/bottom nav, top bar) around whatever the tab returns.
export type TabId = 'home' | 'challenges' | 'events' | 'community' | 'map' | 'garage' | 'store' | 'you';

export interface TabView {
  /** the tab's HTML, drawn inside the shell */
  render: () => string;
  /** wire up buttons after the HTML is in the page; may return a cleanup for when the tab is left */
  bind?: (root: HTMLElement) => void | (() => void);
  /** full-screen tabs (the map) hide the top bar */
  bare?: boolean;
}

const tabs = new Map<TabId, TabView>();
export function registerTab(id: TabId, view: TabView) {
  tabs.set(id, view);
}
export const tabView = (id: TabId) => tabs.get(id);
