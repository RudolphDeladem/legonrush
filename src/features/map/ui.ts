// The Map tab: a full-screen campus map with the university selector, search, filters,
// map styles, the You marker, places, halls, official routes, everyone's pins (events,
// challenges, riders) and the campus collection.
import { icons } from '../../ui/icons';
import { fx } from '../icons';
import { H, esc, fmt, clock } from '../host';
import { allPins, type Pin, type PinKind } from '../pins';
import { CAMPUSES } from '../../data/campuses';
import { exploreRoute } from '../../game/routes';
import { resolvePlace, type Place } from '../../game/campusmap';
import { levelFor, saveSettings, type Profile } from '../../state';
import { isFavourite, toggleFavourite } from '../favourites';
import { huntRoute, treasureScreen, treasureWeek, TREASURE_GOAL } from '../treasure';
import * as cloud from '../../cloud';
import { MapView, drawBadge, iconImage, PALETTES, type MapStyle, type Box } from './canvas';
import { KIND_ICON, KIND_LABEL, campusMap, dist, distText, hasMap, nearestPlace as nearestAny, rideMins, shortName, type CampusMap, type MapHall } from './campus';
import { HIDDEN_XP, creditDiscoveries, claimMilestone, inCollection, isHidden, milestones, progress, readyCount } from './collection';
import { MAP_ROUTES, routeLine, type MapRoute } from './routes';
import { gpsFix, whereAmI, type Where } from './where';
import './map.css';

type Layer = 'places' | 'routes' | 'riders' | 'challenges' | 'events' | 'treasure';
const LAYERS: [Layer, string, string][] = [
  ['places', 'Places', icons.pin], ['routes', 'Routes', fx.route], ['riders', 'Riders', icons.social],
  ['challenges', 'Challenges', icons.flag], ['events', 'Events', icons.events], ['treasure', 'Treasure', fx.chest],
];
const PIN_LAYER: Record<PinKind, Layer> = { event: 'events', challenge: 'challenges', treasure: 'treasure', rider: 'riders', friend: 'riders', crew: 'riders', place: 'places' };
const PIN_LOOK: Record<PinKind, { color: string; icon: string; label: string }> = {
  event: { color: '#e8710a', icon: icons.events, label: 'Event' },
  challenge: { color: '#d93025', icon: icons.flag, label: 'Race challenge' },
  treasure: { color: '#c99a00', icon: fx.chest, label: 'Treasure hunt' },
  rider: { color: '#1e9e55', icon: icons.bike, label: 'Rider' },
  friend: { color: '#f2a900', icon: icons.user, label: 'Friend' },
  crew: { color: '#7a4fb3', icon: icons.social, label: 'Crew' },
  place: { color: '#1a73e8', icon: icons.pin, label: 'Place' },
};
const YOU = '#1a73e8';
const LANDMARK = '#7a4fb3';
const GOLD = '#f5b400';

// map settings, remembered on this phone
const UI_KEY = 'legonrush.mapui.v1';
interface UiPrefs { layers: Layer[]; style: MapStyle; territories: boolean; names: boolean }
function loadPrefs(): UiPrefs {
  const d: UiPrefs = { layers: LAYERS.map(([l]) => l), style: 'standard', territories: true, names: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') }; } catch { return d; }
}
const savePrefs = (p: UiPrefs) => { try { localStorage.setItem(UI_KEY, JSON.stringify(p)); } catch { /* private mode */ } };

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const goTab = (t: string) => (H().home as (t: string) => void)(t);
const stars = (n: number) => `<span class="mp-stars" aria-label="Difficulty ${n} of 5">${'★'.repeat(n)}<i>${'★'.repeat(Math.max(0, 5 - n))}</i></span>`;
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 60 * 24 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

/** a pin placed on the map */
interface MapPin { pin: Pin; x: number; z: number }
/** something tappable drawn this frame */
interface Hit { x: number; y: number; r: number; on: () => void }

const MAJOR_HALLS = (map: CampusMap) => map.halls.map((h) => h.place.name);

export function mapHtml() {
  const p = H().profile();
  const map = campusMap(H().settings.campus);
  const pr = progress(map, p);
  const ready = readyCount(map, p);
  return `
  <div class="mp" id="mp">
    <canvas class="mp-canvas" id="mpCanvas" tabindex="0" aria-label="Map of ${esc(map.title)}. Drag to move, pinch or scroll to zoom."></canvas>
    <div class="mp-top">
      <div class="mp-campus-wrap">
        <button class="mp-campus" id="mpCampus" aria-haspopup="listbox" aria-expanded="false">
          <span class="mp-campus-ico">${icons.grad}</span>
          <span class="grow"><small>University / campus</small><b>${esc(map.title)}</b></span>
          <span class="mp-chev">${icons.chevron}</span>
        </button>
        <div class="mp-campus-menu" id="mpCampusMenu" role="listbox" hidden>
          <p class="mp-menu-head">Select university</p>
          <p class="mp-menu-note" id="mpUniNote" hidden></p>
          ${CAMPUSES.map((c) => `<button role="option" class="mp-uni${c.id === map.campus.id ? ' on' : ''}" data-uni="${c.id}" aria-selected="${c.id === map.campus.id}">
            <span class="mp-uni-ico">${hasMap(c.id) && c.open ? icons.check : icons.lock}</span>
            <span class="grow"><b>${esc(c.name)}</b><small>${hasMap(c.id) && c.open ? `${esc(c.short)} campus` : 'Coming soon'}</small></span></button>`).join('')}
        </div>
      </div>
      <div class="mp-search" id="mpSearchBox">
        <span class="mp-search-ico">${fx.search}</span>
        <input id="mpQ" type="search" autocomplete="off" spellcheck="false" placeholder="Search places, routes, events…" aria-label="Search the campus">
        <button class="mp-x" id="mpClear" aria-label="Clear search" hidden>${icons.close}</button>
        <div class="mp-suggest" id="mpSuggest" role="listbox" hidden></div>
      </div>
      <div class="mp-filters" id="mpFilters" role="toolbar" aria-label="What to show"></div>
    </div>
    <div class="mp-ctrls">
      <button class="mp-btn" id="mpLayers" aria-label="Map style and legend">${icons.layers}</button>
      <button class="mp-btn mp-compass" id="mpCompass" aria-label="Point north"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l3.2 9H8.8z" fill="#e53935"/><path d="M12 21l-3.2-9h6.4z" fill="#9aa3b2"/></svg></button>
      <div class="mp-zoom"><button class="mp-btn" id="mpIn" aria-label="Zoom in">${icons.plus}</button><button class="mp-btn" id="mpOut" aria-label="Zoom out">${icons.minus}</button></div>
      <button class="mp-btn mp-locate" id="mpLocate" aria-label="Locate me">${icons.locate}</button>
    </div>
    <button class="mp-dex" id="mpDex">
      <span class="mp-dex-ico">${fx.medal}</span>
      <span class="grow"><small>Campus collection</small><b><span id="mpDexN">${pr.found}</span> / ${pr.total}</b></span>
      ${ready ? `<em class="mp-dot">${ready}</em>` : ''}
      <span class="mp-dex-bar"><i style="width:${(pr.found / pr.total) * 100}%"></i></span>
    </button>
    <div class="mp-banner" id="mpBanner" role="status" hidden></div>
    <section class="mp-sheet light-ui" id="mpSheet" aria-live="polite" hidden>
      <button class="mp-grab" id="mpGrab" aria-label="Expand or shrink"><i></i></button>
      <button class="mp-close" id="mpClose" aria-label="Close">${icons.close}</button>
      <div class="mp-sheet-body" id="mpBody"></div>
    </section>
    <p class="mp-attrib">${esc(map.attribution)}</p>
  </div>`;
}

export function bindMap(root: HTMLElement): () => void {
  const h = H();
  const p: Profile = h.profile();
  const map = campusMap(h.settings.campus);
  const prefs = loadPrefs();
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const canvas = $<HTMLCanvasElement>('mpCanvas');
  const view = new MapView(canvas, map, ['The Balme Library', 'Great Hall', 'Legon Main Entrance', 'Night Market', 'University of Ghana Registry', 'University of Ghana Hospital', 'Sports Complex', ...MAJOR_HALLS(map)]);
  // for tests in the dev server only
  if (import.meta.env.DEV) (window as unknown as { __map: MapView }).__map = view;
  view.setStyle(prefs.style);
  view.labels = prefs.names;
  // landmarks and halls get a badge; their names sit beside it
  for (const g of map.collection) if (g.id === 'landmarks') g.places.forEach((pl) => view.badged.add(pl.name));
  map.halls.forEach((x) => view.badged.add(x.place.name));
  for (const g of map.collection) if (g.hidden) g.places.forEach((pl) => { if (!(p.visited ?? []).includes(pl.name)) view.unnamed.add(pl.name); });
  const reduced = h.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  let you: Where = whereAmI(map, p);
  let pins: MapPin[] = [];
  let hits: Hit[] = [];
  let selected: { kind: 'place'; place: Place } | { kind: 'route'; route: MapRoute } | { kind: 'pin'; pin: MapPin } | { kind: 'point'; x: number; z: number } | null = null;
  let path: [number, number][] | null = null;
  let hunt: { x: number; z: number; r: number; to: string } | null | undefined;
  const timers: number[] = [];
  const redraw = () => view.draw();
  const icon = (svg: string, color = '#ffffff') => iconImage(svg, color, redraw);
  const desk = () => root.clientWidth >= 900;
  const on = (layer: Layer) => prefs.layers.includes(layer);
  /** the nearest named place, never giving away a hidden spot that is still undiscovered */
  const secret = (pl: Place) => isHidden(map, pl.name) && !(p.visited ?? []).includes(pl.name);
  const nearestPlace = (m: CampusMap, x: number, z: number, kinds?: Place['kind'][]) => nearestAny(m, x, z, kinds, secret);

  // ---------- where to start looking ----------
  view.set({ cx: you.x, cz: you.z, scale: Math.max(view.minScale, desk() ? 0.75 : 0.55) });

  // ---------- filters ----------
  const filters = $('mpFilters');
  const drawFilters = () => {
    const all = prefs.layers.length === LAYERS.length;
    filters.innerHTML = `<button class="mp-chip${all ? ' on' : ''}" data-layer="all" aria-pressed="${all}">Everything</button>` +
      LAYERS.map(([id, label, ic]) => `<button class="mp-chip${!all && on(id) ? ' on' : ''}" data-layer="${id}" aria-pressed="${on(id)}">${ic}<span>${label}</span></button>`).join('');
  };
  filters.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-layer]');
    if (!b) return;
    const id = b.dataset.layer as Layer | 'all';
    const all = prefs.layers.length === LAYERS.length;
    if (id === 'all') prefs.layers = LAYERS.map(([l]) => l);
    else if (all) prefs.layers = [id];
    else if (on(id)) prefs.layers = prefs.layers.filter((l) => l !== id);
    else prefs.layers = [...prefs.layers, id];
    if (!prefs.layers.length) prefs.layers = LAYERS.map(([l]) => l);
    savePrefs(prefs);
    drawFilters();
    if (id === 'routes' && on('routes')) {
      // show the whole route network once it is switched on by itself
      if (prefs.layers.length === 1) view.fit(MAP_ROUTES.flatMap((r) => routeLine(r).map(([x, z]) => ({ x, z }))), pads(), 1);
    }
    if (id === 'treasure' && on('treasure')) {
      const t = treasureArea();
      if (t && prefs.layers.length === 1) view.fit([{ x: t.x - t.r, z: t.z - t.r }, { x: t.x + t.r, z: t.z + t.r }], pads(), 1.2);
    }
    const empty = emptyNote(id);
    if (empty) banner(empty, [], 5000);
    redraw();
  });
  drawFilters();
  const emptyNote = (id: Layer | 'all') => {
    if (id === 'all' || !on(id)) return '';
    const n = pins.filter((m) => PIN_LAYER[m.pin.kind] === id).length;
    if (id === 'riders' && !n) return `${icons.social} No riders are sharing their location right now. Riders only show here if they choose to.`;
    if (id === 'challenges' && !n) return `${icons.flag} No race challenges on the map right now.`;
    if (id === 'events' && !n) return `${icons.events} No events on the map right now.`;
    return '';
  };

  // ---------- pins from every system ----------
  const placePin = (pin: Pin): MapPin | null => {
    if (pin.lat !== undefined && pin.lng !== undefined) {
      const [x, z] = map.fromLatLng(pin.lat, pin.lng);
      return { pin, x, z };
    }
    const pl = pin.place ? map.placeByName(pin.place) ?? resolvePlace(pin.place) : undefined;
    return pl ? { pin, x: pl.x, z: pl.z } : null;
  };
  const loadPins = async () => {
    if (!canvas.isConnected) return;
    const list = await allPins();
    pins = list.map(placePin).filter((m): m is MapPin => !!m);
    // pins on the same spot fan out a little
    const at = new Map<string, number>();
    for (const m of pins) {
      const k = `${Math.round(m.x / 12)},${Math.round(m.z / 12)}`;
      const n = at.get(k) ?? 0;
      at.set(k, n + 1);
      if (n) { const a = n * 2.4; m.x += Math.cos(a) * 14 * Math.sqrt(n); m.z += Math.sin(a) * 14 * Math.sqrt(n); }
    }
    view.animate = !reduced && pins.some((m) => m.pin.live);
    redraw();
    nearbyNotice();
  };
  void loadPins();
  timers.push(window.setInterval(() => { if (!canvas.isConnected) return stop(); void loadPins(); }, 30000));

  // ---------- treasure: the area to search, never the spot ----------
  const treasureArea = () => {
    if (hunt !== undefined) return hunt;
    hunt = null;
    try {
      const t = treasureWeek(p);
      if (t.found >= TREASURE_GOAL && t.claimed) return hunt;
      const r = huntRoute(p);
      if (!r) return hunt;
      const pts = r.track.outline(10).slice(Math.floor(r.track.outline(10).length * 0.45));
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      const rad = Math.min(380, Math.max(200, Math.hypot(maxX - minX, maxZ - minZ) / 2 + 60));
      const j = hash('hunt' + t.week);
      hunt = { x: (minX + maxX) / 2 + Math.cos(j * 6.28) * rad * 0.15, z: (minZ + maxZ) / 2 + Math.sin(j * 6.28) * rad * 0.15, r: rad, to: r.to.name };
    } catch { hunt = null; }
    return hunt;
  };

  // ---------- drawing on top of the campus ----------
  const territory = (hall: MapHall) => ({ x: hall.place.x, z: hall.place.z, r: 110 });
  view.onBeforeLabels = () => {
    const ctx = view.ctx;
    const s = view.scale;
    // hall colours: a soft circle of each hall's colour around it
    if (on('places') && prefs.territories && s > 0.16 && s < 1.1) {
      for (const hall of map.halls) {
        const t = territory(hall);
        const [sx, sy] = view.toScreen(t.x, t.z);
        const r = t.r * s;
        if (sx < -r || sy < -r || sx > view.w + r || sy > view.h + r) continue;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = hall.color + (prefs.style === 'night' ? '2a' : '17');
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = hall.color + '66';
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // treasure search areas
    if (on('treasure')) {
      const areas: { x: number; z: number; r: number }[] = [];
      const t = treasureArea();
      if (t) areas.push(t);
      for (const m of pins) if (m.pin.kind === 'treasure') areas.push(fuzzy(m));
      for (const a of areas) {
        const [sx, sy] = view.toScreen(a.x, a.z);
        const r = a.r * s;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245,180,0,0.13)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = 'rgba(201,154,0,0.85)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // official routes
    if (on('routes')) {
      const sel = selected?.kind === 'route' ? selected.route : null;
      for (const r of MAP_ROUTES) if (r !== sel) line(routeLine(r), r.color, sel ? 3 : 4, sel ? 0.45 : 0.9);
      if (sel) line(routeLine(sel), sel.color, 7, 1);
    } else if (selected?.kind === 'route') line(routeLine(selected.route), selected.route.color, 7, 1);
    // directions
    if (path) line(path, YOU, 6, 1, true);
    // keep pin spots and You clear of labels
    {
      const [sx, sy] = view.toScreen(you.x, you.z);
      view.reserved.push({ x0: sx - 14, y0: sy - 14, x1: sx + 14, y1: sy + 28 });
    }
    for (const m of visiblePins()) {
      const [sx, sy] = view.toScreen(m.x, m.z);
      view.reserved.push({ x0: sx - 14, y0: sy - 30, x1: sx + 14, y1: sy + 4 });
    }
    const keep = (x: number, z: number, r: number) => {
      const [sx, sy] = view.toScreen(x, z);
      view.reserved.push({ x0: sx - r, y0: sy - r, x1: sx + r, y1: sy + r });
    };
    if (on('treasure')) {
      const t = treasureArea();
      for (const a of [...(t ? [t] : []), ...pins.filter((m) => m.pin.kind === 'treasure').map(fuzzy)]) keep(a.x, a.z, 15);
    }
    // badges: landmarks, hidden spots, halls and route starts
    if (on('places')) {
      for (const g of map.collection) if (g.id === 'landmarks' || (g.hidden && s >= 0.3)) g.places.forEach((pl) => keep(pl.x, pl.z, 11));
      if (s > 0.16) map.halls.forEach((x) => keep(x.place.x, x.place.z, 11));
    }
    if (on('routes') && s > 0.2) for (const r of MAP_ROUTES) { const l = routeLine(r); if (l.length) keep(l[0][0], l[0][1], 10); }
  };
  const line = (pts: [number, number][], color: string, width: number, alpha: number, dashed = false) => {
    if (pts.length < 2) return;
    const ctx = view.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([x, z], i) => { const [sx, sy] = view.toScreen(x, z); (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx, sy); });
    ctx.strokeStyle = prefs.style === 'night' ? '#0d1220' : '#ffffff';
    ctx.lineWidth = width + 3;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dashed) ctx.setLineDash([1, width * 1.7]);
    ctx.stroke();
    ctx.restore();
  };
  const fuzzy = (m: MapPin) => {
    const j = hash(m.pin.id);
    return { x: m.x + Math.cos(j * 6.28) * 90, z: m.z + Math.sin(j * 6.28) * 90, r: 240 };
  };
  const visiblePins = () => pins.filter((m) => m.pin.kind !== 'treasure' && on(PIN_LAYER[m.pin.kind]));

  view.onDraw = (ctx, now) => {
    hits = [];
    const s = view.scale;
    const visited = new Set(p.visited ?? []);
    // collection markers: landmarks (filled once discovered) and hidden spots as "?"
    if (on('places')) {
      for (const g of map.collection) {
        const landmark = g.id === 'landmarks';
        if (!landmark && !g.hidden) continue;
        if (!landmark && s < 0.3) continue;
        for (const pl of g.places) {
          const [sx, sy] = view.toScreen(pl.x, pl.z);
          if (sx < -20 || sy < -20 || sx > view.w + 20 || sy > view.h + 20) continue;
          const found = visited.has(pl.name);
          if (g.hidden && !found) {
            drawBadge(ctx, sx, sy, 10, '#0b1530', icon(icons.question, '#ffd21f'), '#ffd21f');
            hits.push({ x: sx, y: sy, r: 16, on: () => openHidden(pl) });
          } else {
            const r = s > 0.5 ? 9.5 : 7.5;
            drawBadge(ctx, sx, sy - 0, r, found ? LANDMARK : '#ffffff', icon(found ? fx.starFill : icons.star, found ? '#ffffff' : LANDMARK), found ? GOLD : LANDMARK);
            hits.push({ x: sx, y: sy, r: r + 6, on: () => openPlace(pl) });
          }
        }
      }
      // hall crests
      if (s > 0.16) {
        for (const hall of map.halls) {
          const [sx, sy] = view.toScreen(hall.place.x, hall.place.z);
          if (sx < -20 || sy < -20 || sx > view.w + 20 || sy > view.h + 20) continue;
          const mine = hall.id === p.hall;
          drawBadge(ctx, sx, sy, mine ? 11 : 9, hall.color, icon(icons.bed), mine ? GOLD : '#ffffff');
          hits.push({ x: sx, y: sy, r: 16, on: () => openPlace(hall.place) });
        }
      }
    }
    // route start flags
    if (on('routes') && s > 0.2) {
      for (const r of MAP_ROUTES) {
        const l = routeLine(r);
        if (!l.length) continue;
        const [sx, sy] = view.toScreen(l[0][0], l[0][1]);
        drawBadge(ctx, sx, sy, 8.5, r.color, icon(icons.flag));
        hits.push({ x: sx, y: sy, r: 14, on: () => openRoute(r) });
      }
    }
    // treasure: a chest in the middle of each search area
    if (on('treasure')) {
      const t = treasureArea();
      if (t) {
        const [sx, sy] = view.toScreen(t.x, t.z);
        drawBadge(ctx, sx, sy, 13, GOLD, icon(fx.chest, '#0b1530'));
        hits.push({ x: sx, y: sy, r: Math.max(20, t.r * s * 0.8), on: () => openHunt() });
      }
      for (const m of pins) {
        if (m.pin.kind !== 'treasure') continue;
        const a = fuzzy(m);
        const [sx, sy] = view.toScreen(a.x, a.z);
        drawBadge(ctx, sx, sy, 13, GOLD, icon(fx.chest, '#0b1530'));
        hits.push({ x: sx, y: sy, r: Math.max(20, a.r * s * 0.8), on: () => openPin(m) });
      }
    }
    // everyone's pins
    const pulse = reduced ? 0 : (now % 1600) / 1600;
    for (const m of visiblePins()) {
      const [sx, sy] = view.toScreen(m.x, m.z);
      if (sx < -30 || sy < -40 || sx > view.w + 30 || sy > view.h + 30) continue;
      const look = PIN_LOOK[m.pin.kind];
      const person = m.pin.kind === 'rider' || m.pin.kind === 'friend';
      if (m.pin.live) {
        ctx.beginPath();
        ctx.arc(sx, person ? sy : sy - 16, 12 + pulse * 16, 0, Math.PI * 2);
        ctx.fillStyle = look.color + Math.round((1 - pulse) * 90).toString(16).padStart(2, '0');
        ctx.fill();
      }
      if (person) drawBadge(ctx, sx, sy, 10, look.color, icon(look.icon));
      else drawBadge(ctx, sx, sy - 16, 12, look.color, icon(look.icon), '#ffffff', true);
      hits.push({ x: sx, y: person ? sy : sy - 16, r: 18, on: () => openPin(m) });
    }
    // You
    {
      const [sx, sy] = view.toScreen(you.x, you.z);
      const halo = you.source === 'gps' ? 26 : 18;
      ctx.beginPath();
      ctx.arc(sx, sy, halo + (reduced ? 0 : Math.sin(now / 500) * 2), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(26,115,232,0.16)';
      ctx.fill();
      drawBadge(ctx, sx, sy, 9, YOU, null);
      ctx.font = '800 10px Sora, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTES[prefs.style].halo;
      ctx.strokeText('YOU', sx, sy + 22);
      ctx.fillStyle = prefs.style === 'night' ? '#8ab4f8' : YOU;
      ctx.fillText('YOU', sx, sy + 22);
      ctx.textAlign = 'left';
      hits.push({ x: sx, y: sy, r: 18, on: () => openYou() });
    }
    // the selected place or point
    const sel = selected?.kind === 'place' ? selected.place : selected?.kind === 'point' ? selected : null;
    if (sel) {
      const [sx, sy] = view.toScreen(sel.x, sel.z);
      drawBadge(ctx, sx, sy - 20, 13, '#ea4335', null, '#ffffff', true);
      ctx.beginPath();
      ctx.arc(sx, sy - 20, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#7d1a12';
      ctx.fill();
    }
    compass();
  };

  // ---------- tapping ----------
  view.onTap = (sx, sy) => {
    closeMenus();
    let best: Hit | null = null, bd = Infinity;
    for (const t of hits) {
      const d = Math.hypot(t.x - sx, t.y - sy);
      if (d <= t.r && d <= bd + 2) { best = t; bd = Math.min(bd, d); }
    }
    if (best) return best.on();
    const lab = view.labelHits.find((l) => sx >= l.box.x0 && sx <= l.box.x1 && sy >= l.box.y0 && sy <= l.box.y1);
    if (lab) return openPlace(lab.place);
    if (on('routes')) {
      for (const r of MAP_ROUTES) if (nearLine(routeLine(r), sx, sy, 10)) return openRoute(r);
    }
    // anything named close to the finger
    const [x, z] = view.toWorld(sx, sy);
    const near = map.places.filter((pl) => pl.kind !== 'transport' && !secret(pl)).map((pl) => ({ pl, d: Math.hypot(pl.x - x, pl.z - z) * view.scale })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 22) return openPlace(near.pl);
    if (selected) return closeSheet();
  };
  view.onLongPress = (sx, sy) => {
    const [x, z] = view.toWorld(sx, sy);
    navigator.vibrate?.(15);
    openPoint(x, z);
  };
  const nearLine = (pts: [number, number][], sx: number, sy: number, tol: number) => {
    let prev: [number, number] | null = null;
    for (const [x, z] of pts) {
      const q = view.toScreen(x, z);
      if (prev) {
        const [ax, ay] = prev, [bx, by] = q;
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / l2));
        if (Math.hypot(ax + t * (bx - ax) - sx, ay + t * (by - ay) - sy) < tol) return true;
      }
      prev = q;
    }
    return false;
  };

  // ---------- controls ----------
  const compassBtn = $('mpCompass');
  const needle = compassBtn.querySelector('svg')!;
  const compass = () => {
    needle.style.transform = `rotate(${view.rot}rad)`;
    compassBtn.classList.toggle('turned', Math.abs(view.rot) > 0.01);
  };
  compassBtn.addEventListener('click', () => view.flyTo({ rot: 0 }));
  $('mpIn').addEventListener('click', () => view.flyTo({ scale: view.scale * 1.8 }, 240));
  $('mpOut').addEventListener('click', () => view.flyTo({ scale: view.scale / 1.8 }, 240));
  $('mpLocate').addEventListener('click', async () => {
    const btn = $('mpLocate');
    view.focus(you.x, you.z, Math.max(view.scale, 1.3), sheetOffset());
    if (you.source === 'gps' || btn.classList.contains('busy')) return;
    // ask the phone once: if it is on campus, the You marker moves to where you really are
    btn.classList.add('busy');
    const fix = await gpsFix(map);
    btn.classList.remove('busy');
    if (!canvas.isConnected) return;
    if (fix === 'denied') return banner(`${icons.locate} Showing ${wherePhrase()}. Allow location to see where you really are on campus.`, [], 5000);
    if (fix === 'off-campus') return banner(`${icons.locate} You're not on campus right now, so the map shows ${wherePhrase()}.`, [], 5000);
    you = fix;
    btn.classList.add('on');
    view.focus(you.x, you.z, Math.max(view.scale, 1.6), sheetOffset());
  });
  const wherePhrase = () => (you.source === 'ride' ? 'where your last ride ended' : you.source === 'hall' ? 'your hall' : 'the main gate');

  // ---------- university selector ----------
  const campusBtn = $('mpCampus'), campusMenu = $('mpCampusMenu');
  const closeMenus = () => {
    campusMenu.hidden = true;
    campusBtn.setAttribute('aria-expanded', 'false');
    $('mpUniNote').hidden = true;
    $('mpSuggest').hidden = true;
  };
  campusBtn.addEventListener('click', () => {
    const open = campusMenu.hidden;
    closeMenus();
    campusMenu.hidden = !open;
    campusBtn.setAttribute('aria-expanded', String(open));
  });
  campusMenu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-uni]');
    if (!b) return;
    const c = CAMPUSES.find((x) => x.id === b.dataset.uni)!;
    if (!c.open || !hasMap(c.id)) {
      const note = $('mpUniNote');
      note.hidden = false;
      note.innerHTML = `${icons.lock} <b>${esc(c.short)}</b> is coming soon. When its campus opens, its map, routes and halls appear here.`;
      return;
    }
    closeMenus();
    if (c.id !== h.settings.campus) {
      h.settings.campus = c.id;
      saveSettings(h.settings);
      goTab('map');
    }
  });

  // ---------- search ----------
  const q = $<HTMLInputElement>('mpQ'), sug = $('mpSuggest'), clearBtn = $('mpClear');
  type Result = { html: string; go: () => void };
  let results: Result[] = [];
  let active = 0;
  const row = (ic: string, color: string, title: string, sub: string, right = '') =>
    `<span class="mp-r-ico" style="--c:${color}">${ic}</span><span class="grow"><b>${title}</b><small>${sub}</small></span>${right ? `<small class="mp-r-right">${right}</small>` : ''}`;
  const search = () => {
    const text = q.value.trim();
    clearBtn.hidden = !text;
    results = [];
    const sections: [string, Result[]][] = [];
    if (!text) {
      const hall = map.hallPlace(p.hall);
      const sugg: Result[] = [];
      if (hall) sugg.push({ html: row(icons.bed, map.halls.find((x) => x.id === p.hall)?.color ?? '#555', esc(shortName(hall.name)), 'Your hall'), go: () => openPlace(hall, true) });
      for (const n of p.favourites ?? []) {
        const pl = map.placeByName(n);
        if (pl) sugg.push({ html: row(fx.starFill, GOLD, esc(shortName(pl.name)), 'Saved place'), go: () => openPlace(pl, true) });
      }
      for (const n of ['Great Hall', 'The Balme Library', 'Night Market', 'Jones Quartey Building, JQB', 'Legon Main Entrance']) {
        const pl = map.placeByName(n);
        if (pl && !sugg.some((s) => s.html.includes(esc(shortName(pl.name))))) sugg.push({ html: row(icons[KIND_ICON[pl.kind] as keyof typeof icons] ?? icons.pin, LANDMARK, esc(shortName(pl.name)), KIND_LABEL[pl.kind], distText(dist(you, pl))), go: () => openPlace(pl, true) });
      }
      sections.push(['Try', sugg.slice(0, 7)]);
    } else {
      const f = fold(text);
      const places = map.search(text, 8).filter((m) => !secret(m.place)).slice(0, 6).map((m): Result => ({
        html: row(icons[KIND_ICON[m.place.kind] as keyof typeof icons] ?? icons.pin, PALETTES.standard.kind[m.place.kind] ?? '#555', esc(m.place.name) + (m.alias ? ` <em>“${esc(m.alias)}”</em>` : ''), `${KIND_LABEL[m.place.kind]} · ${distText(dist(you, m.place))} away`),
        go: () => openPlace(m.place, true),
      }));
      const routes = MAP_ROUTES.filter((r) => fold(r.name).includes(f) || r.stops.some((s) => fold(s).includes(f))).slice(0, 4).map((r): Result => ({
        html: row(fx.route, r.color, esc(r.name), `Cycling route${routeLine(r).length ? ` · ${distText(lineLength(routeLine(r)))}` : ''}`),
        go: () => openRoute(r, true),
      }));
      const acts = pins.filter((m) => fold(`${m.pin.title} ${m.pin.sub ?? ''}`).includes(f)).slice(0, 5).map((m): Result => ({
        html: row(PIN_LOOK[m.pin.kind].icon, PIN_LOOK[m.pin.kind].color, esc(m.pin.title), `${PIN_LOOK[m.pin.kind].label}${m.pin.sub ? ` · ${esc(m.pin.sub)}` : ''}`, m.pin.live ? 'Live' : ''),
        go: () => openPin(m, true),
      }));
      const t = treasureArea();
      if (t && /treas|hunt|chest/.test(f)) acts.push({ html: row(fx.chest, GOLD, 'Treasure hunt', 'This week’s search area'), go: () => openHunt(true) });
      if (places.length) sections.push(['Places', places]);
      if (routes.length) sections.push(['Routes', routes]);
      if (acts.length) sections.push(['On the map now', acts]);
    }
    results = sections.flatMap(([, r]) => r);
    active = 0;
    let i = 0;
    sug.innerHTML = sections.length
      ? sections.map(([head, list]) => `<p class="mp-s-head">${head}</p>${list.map((r) => `<button class="mp-result${i === 0 ? ' on' : ''}" data-i="${i++}" role="option">${r.html}</button>`).join('')}`).join('')
      : `<p class="mp-s-empty">Nothing called “${esc(text)}” on this campus. Try a hall, a faculty or what students call it, like Vandals, Pent or JQB.</p>`;
    sug.hidden = false;
  };
  const choose = (i: number) => {
    const r = results[i];
    if (!r) return;
    sug.hidden = true;
    q.blur();
    r.go();
  };
  q.addEventListener('focus', () => { campusMenu.hidden = true; search(); });
  q.addEventListener('input', search);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % Math.max(1, results.length);
      sug.querySelectorAll('.mp-result').forEach((b, k) => b.classList.toggle('on', k === active));
      e.preventDefault();
    } else if (e.key === 'Enter') { choose(active); e.preventDefault(); }
    else if (e.key === 'Escape') { sug.hidden = true; q.blur(); }
  });
  sug.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (b) { e.preventDefault(); choose(Number(b.dataset.i)); }
  });
  q.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 160));
  clearBtn.addEventListener('click', () => { q.value = ''; search(); q.focus(); });

  // ---------- sheets ----------
  const sheet = $('mpSheet'), body = $('mpBody');
  const pads = (): [number, number, number, number] => {
    const top = ($('mpSearchBox').getBoundingClientRect().bottom - root.getBoundingClientRect().top) + 50;
    if (desk()) return [sheet.hidden ? top + 60 : 70, 80, 60, sheet.hidden ? 60 : 440];
    return [top, 60, sheet.hidden ? 90 : Math.min(root.clientHeight * 0.55, sheet.offsetHeight) + 30, 40];
  };
  const sheetOffset = (): [number, number] => {
    if (sheet.hidden) return [0, 0];
    if (desk()) return [200, 0];
    const top = 150;
    const covered = Math.min(sheet.offsetHeight, root.clientHeight * 0.62);
    return [0, (top - covered) / 2];
  };
  const placeSheet = () => {
    if (!desk()) { sheet.style.top = ''; return; }
    const top = root.querySelector('.mp-top')!.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    sheet.style.top = `${Math.round(top + 10)}px`;
  };
  const ro = new ResizeObserver(placeSheet);
  ro.observe(root);
  const openSheet = (html: string, bindFn?: (b: HTMLElement) => void) => {
    placeSheet();
    body.innerHTML = html;
    sheet.hidden = false;
    sheet.classList.remove('tall');
    body.scrollTop = 0;
    bindFn?.(body);
    redraw();
  };
  const closeSheet = () => {
    sheet.hidden = true;
    selected = null;
    path = null;
    redraw();
  };
  $('mpClose').addEventListener('click', closeSheet);
  $('mpGrab').addEventListener('click', () => sheet.classList.toggle('tall'));
  // swipe the sheet down to close it
  {
    let y0 = -1;
    const grab = $('mpGrab');
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
    grab.addEventListener('pointerup', (e) => { if (y0 >= 0 && e.clientY - y0 > 60) closeSheet(); y0 = -1; });
  }
  const bindActs = (b: HTMLElement, acts: Record<string, () => void>) => {
    for (const [id, fn] of Object.entries(acts)) b.querySelector(`[data-act="${id}"]`)?.addEventListener('click', fn);
  };
  const gmaps = (x: number, z: number) => `https://www.google.com/maps/search/?api=1&query=${map.toLatLng(x, z).map((v) => v.toFixed(6)).join(',')}`;
  const fromPlace = () => nearestPlace(map, you.x, you.z);

  /** start an Explore ride to a place, from the place nearest to you */
  const rideTo = (to: Place) => {
    const from = fromPlace();
    if (from === to || dist(from, to) < 40) return banner(`${icons.pin} You're already at ${esc(shortName(to.name))}. Pick somewhere else to ride.`, [], 5000);
    const route = exploreRoute(from, to, 'cycle');
    if (!route) return banner('No road connects those two places on the map yet.', [], 5000);
    h.play(route, {});
  };

  const nearbyHtml = (x: number, z: number, skip?: string) => {
    const close = pins.filter((m) => m.pin.kind !== 'treasure' && Math.hypot(m.x - x, m.z - z) < 500);
    const count = (k: PinKind[]) => close.filter((m) => k.includes(m.pin.kind)).length;
    const routesNear = MAP_ROUTES.filter((r) => routeLine(r).some(([a, b]) => Math.hypot(a - x, b - z) < 90));
    const rows: string[] = [];
    const ch = count(['challenge']), ev = count(['event']), rd = count(['rider', 'friend', 'crew']);
    if (ch) rows.push(`<span>${icons.flag} ${ch} challenge${ch === 1 ? '' : 's'}</span>`);
    if (ev) rows.push(`<span>${icons.events} ${ev} event${ev === 1 ? '' : 's'}</span>`);
    if (rd) rows.push(`<span>${icons.social} ${rd} rider${rd === 1 ? '' : 's'}</span>`);
    if (routesNear.length) rows.push(`<span>${fx.route} ${routesNear.length} route${routesNear.length === 1 ? '' : 's'}</span>`);
    const places = map.places.filter((q2) => q2.name !== skip && !secret(q2) && q2.kind !== 'transport' && q2.kind !== 'other' && Math.hypot(q2.x - x, q2.z - z) < 260)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
      .filter((q2, i, all) => all.findIndex((o) => shortName(o.name) === shortName(q2.name)) === i).slice(0, 4);
    return `<div class="mp-near">
      <p class="mp-label">Nearby</p>
      ${rows.length ? `<div class="mp-near-counts">${rows.join('')}</div>` : '<p class="muted small">No live activity within 500 m right now.</p>'}
      ${close.length ? `<div class="mp-list">${close.slice(0, 4).map((m) => `<button class="mp-li" data-pin="${esc(m.pin.id)}"><span class="mp-r-ico" style="--c:${PIN_LOOK[m.pin.kind].color}">${PIN_LOOK[m.pin.kind].icon}</span><span class="grow"><b>${esc(m.pin.title)}</b><small>${esc(m.pin.sub ?? PIN_LOOK[m.pin.kind].label)}</small></span>${m.pin.live ? '<em class="mp-live">Live</em>' : ''}</button>`).join('')}</div>` : ''}
      ${places.length ? `<p class="muted small mp-near-places">${places.map((q2) => `<button class="mp-plink" data-place="${esc(q2.name)}">${esc(shortName(q2.name))}</button>`).join(' · ')}</p>` : ''}
    </div>`;
  };
  const bindNearby = (b: HTMLElement) => {
    b.querySelectorAll<HTMLElement>('[data-pin]').forEach((el) => el.addEventListener('click', () => { const m = pins.find((x) => x.pin.id === el.dataset.pin); if (m) openPin(m, true); }));
    b.querySelectorAll<HTMLElement>('[data-place]').forEach((el) => el.addEventListener('click', () => { const pl = map.placeByName(el.dataset.place!); if (pl) openPlace(pl, true); }));
  };

  function openPlace(pl: Place, fly = false) {
    selected = { kind: 'place', place: pl };
    path = null;
    const hall = map.halls.find((x) => x.place.name === pl.name);
    const fact = map.fact(pl.name);
    const photo = map.photo(pl.name);
    const d = dist(you, pl);
    const found = (p.visited ?? []).includes(pl.name);
    const counted = inCollection(map, pl.name);
    const fav = isFavourite(p, pl.name);
    const kindIcon = icons[KIND_ICON[pl.kind] as keyof typeof icons] ?? icons.pin;
    openSheet(`
      ${photo ? `<div class="mp-photo" style="background-image:url('${photo}')"></div>` : ''}
      <div class="mp-head">
        <span class="mp-head-ico" style="--c:${hall?.color ?? PALETTES.standard.kind[pl.kind] ?? '#555'}">${hall ? icons.bed : kindIcon}</span>
        <div class="grow"><h2>${esc(pl.name)}</h2><p>${hall ? `Hall of residence${hall.short !== shortName(hall.name) ? ` · “${esc(hall.short)}”` : ''}` : KIND_LABEL[pl.kind]} · ${esc(map.title)}</p></div>
      </div>
      <div class="mp-facts">
        <span><b>${distText(d)}</b><small>from you</small></span>
        <span><b>${rideMins(d * 1.25)} min</b><small>by bike</small></span>
        ${counted ? `<span><b class="${found ? 'mp-ok' : ''}">${found ? `${icons.check} Yes` : 'Not yet'}</b><small>Discovered</small></span>` : ''}
      </div>
      ${fact ? `<p class="mp-text">${esc(fact.text)}</p>` : ''}
      ${counted && !found ? `<p class="mp-hint">${fx.medal} Ride here to add it to your campus collection.</p>` : ''}
      <div class="mp-acts">
        <button class="btn btn-primary" data-act="ride">${icons.bike} Ride here</button>
        <button class="btn btn-ghost" data-act="dir">${icons.directions} Directions</button>
      </div>
      <div class="mp-acts mp-acts-sm">
        <button class="btn btn-ghost btn-sm${fav ? ' on' : ''}" data-act="fav">${fav ? fx.starFill : icons.star} ${fav ? 'Saved' : 'Save'}</button>
        <button class="btn btn-ghost btn-sm" data-act="opts">${icons.gear} Ride options</button>
        <a class="btn btn-ghost btn-sm" href="${gmaps(pl.x, pl.z)}" target="_blank" rel="noopener">${icons.map} Google Maps</a>
      </div>
      <div id="mpDir"></div>
      ${hall ? `<div class="mp-hall" id="mpHall"><p class="mp-label">Hall Week</p><p class="muted small">Loading the standings…</p></div>` : ''}
      ${nearbyHtml(pl.x, pl.z, pl.name)}`, (b) => {
      bindActs(b, {
        ride: () => rideTo(pl),
        dir: () => directionsTo(pl.x, pl.z, pl.name, b.querySelector('#mpDir')!),
        fav: () => { toggleFavourite(p, pl.name); openPlace(pl); },
        opts: () => h.explore(fromPlace().name, pl.name),
      });
      bindNearby(b);
      if (hall) void hallStandings(hall, b.querySelector('#mpHall')!);
    });
    if (fly) view.focus(pl.x, pl.z, Math.max(view.scale, 1.5), sheetOffset());
    else ensureVisible(pl.x, pl.z);
  }

  /** if the point is under the sheet, move the map so it isn't */
  const ensureVisible = (x: number, z: number) => {
    const [sx, sy] = view.toScreen(x, z);
    const r = sheet.getBoundingClientRect(), rr = root.getBoundingClientRect();
    const covered = desk() ? sx < r.right - rr.left + 20 : sy > r.top - rr.top - 30;
    if (covered || sx < 0 || sy < 0 || sx > view.w || sy > view.h) view.focus(x, z, view.scale, sheetOffset());
  };

  const directionsTo = (x: number, z: number, name: string, box: HTMLElement) => {
    const r = map.path([you.x, you.z], [x, z], 'cycle', shortName(name));
    if (!r || r.length < 15) {
      box.innerHTML = `<p class="muted small">You're right there.</p>`;
      return;
    }
    path = r.points;
    view.fit([{ x: you.x, z: you.z }, { x, z }, ...r.points.filter((_, i) => i % 8 === 0).map(([a, b]) => ({ x: a, z: b }))], pads(), 2.2);
    const ARROW: Record<string, string> = { start: '↑', straight: '↑', 'slight-left': '↖', 'slight-right': '↗', left: '←', right: '→', 'sharp-left': '↙', 'sharp-right': '↘', arrive: '◎', stop: '◎' };
    box.innerHTML = `<div class="mp-dir">
      <p class="mp-label">Directions from ${you.source === 'gps' ? 'where you are' : you.source === 'ride' ? 'where your last ride ended' : you.source === 'hall' ? 'your hall' : 'the main gate'}</p>
      <p class="small"><b>${distText(r.length)}</b> · about ${rideMins(r.length)} min by bike · ${Math.max(1, Math.round(r.length / 80))} min on foot</p>
      <ol class="mp-steps">${r.steps.map((s, i) => `<li><span class="mp-turn">${ARROW[s.turn] ?? '↑'}</span><span class="grow">${esc(s.text)}</span>${i < r.steps.length - 1 ? `<small>${distText(r.steps[i + 1].at - s.at)}</small>` : ''}</li>`).join('')}</ol>
    </div>`;
    // from you to the road, and from the road to the door
    path = [[you.x, you.z], ...r.points, [x, z]];
    body.scrollTo({ top: Math.max(0, box.offsetTop - 70), behavior: reduced ? 'auto' : 'smooth' });
    redraw();
  };

  const hallStandings = async (hall: MapHall, box: HTMLElement) => {
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000));
    try {
      const rows = await Promise.race([cloud.hallStandings(), timeout]);
      if (!box.isConnected) return;
      const all = map.halls.map((x) => ({ x, km: rows.find((r) => r.hall === x.id)?.km ?? 0, riders: rows.find((r) => r.hall === x.id)?.riders ?? 0 }))
        .sort((a, b) => b.km - a.km || a.x.name.localeCompare(b.x.name));
      const i = all.findIndex((a) => a.x.id === hall.id);
      const me = all[i];
      box.innerHTML = `<p class="mp-label">Hall Week</p>
        <div class="mp-facts"><span><b>#${i + 1}</b><small>of ${all.length} halls</small></span><span><b>${me.km.toFixed(1)} km</b><small>ridden since Monday</small></span><span><b>${fmt(me.riders)}</b><small>rider${me.riders === 1 ? '' : 's'}</small></span></div>
        <details class="mp-board"><summary>All halls</summary>${all.map((a, k) => `<div class="mp-board-row${a.x.id === hall.id ? ' me' : ''}"><span>${k + 1}</span><i style="background:${a.x.color}"></i><span class="grow">${esc(a.x.short)}</span><b>${a.km.toFixed(1)} km</b></div>`).join('')}</details>
        ${p.hall === hall.id ? '<p class="muted small">Your hall. Every kilometre you ride counts for it.</p>' : ''}`;
    } catch {
      if (!box.isConnected) return;
      box.innerHTML = `<p class="mp-label">Hall Week</p><p class="muted small">${navigator.onLine ? 'Hall standings show here once the leaderboard can be reached.' : 'Hall standings need a connection.'}${p.hall === hall.id ? ' This is your hall: every kilometre you ride counts for it.' : ''}</p>`;
    }
  };

  function openRoute(r: MapRoute, fly = false) {
    selected = { kind: 'route', route: r };
    path = null;
    const l = routeLine(r);
    const len = lineLength(l);
    const best = p.bestTimes?.[r.id];
    const locked = levelFor(p.xp) < r.level;
    const time = r.time === 'night' ? `${icons.moon} Night` : r.time === 'sunset' ? `${icons.sunrise} Sunset` : `${icons.sun} Day`;
    const start = l.length ? { x: l[0][0], z: l[0][1] } : null;
    openSheet(`
      <div class="mp-head"><span class="mp-head-ico" style="--c:${r.color}">${fx.route}</span><div class="grow"><h2>${esc(r.name)}</h2><p>Official LEGONRUSH route · ${esc(map.campus.short)}</p></div></div>
      <div class="mp-facts">
        <span><b>${len ? distText(len) : '—'}</b><small>distance</small></span>
        <span><b>${stars(r.difficulty)}</b><small>difficulty</small></span>
        <span><b>${best !== undefined ? clock(best) : '—'}</b><small>your best</small></span>
      </div>
      <p class="mp-text">${esc(r.blurb)}</p>
      <p class="muted small">${time} ride${start ? ` · starts ${distText(dist(you, start))} from you` : ''}</p>
      ${locked ? `<p class="mp-hint">${icons.lock} Opens at level ${r.level}.</p>` : ''}
      <div class="mp-acts">
        <button class="btn btn-primary" data-act="ride" ${locked ? 'disabled' : ''}>${icons.bike} Ride this route</button>
        <button class="btn btn-ghost" data-act="show">${icons.map} Whole route</button>
      </div>
      ${start ? nearbyHtml(start.x, start.z) : ''}`, (b) => {
      bindActs(b, {
        ride: () => { const route = r.route(); if (route) h.play(route, {}); },
        show: () => view.fit(l.map(([x, z]) => ({ x, z })), pads(), 2),
      });
      bindNearby(b);
    });
    if (fly || l.length) view.fit(l.map(([x, z]) => ({ x, z })), pads(), 2);
  }

  function openPin(m: MapPin, fly = false) {
    selected = { kind: 'pin', pin: m };
    path = null;
    const look = PIN_LOOK[m.pin.kind];
    const treasure = m.pin.kind === 'treasure';
    const person = m.pin.kind === 'rider' || m.pin.kind === 'friend' || m.pin.kind === 'crew';
    const near = nearestPlace(map, m.x, m.z);
    openSheet(`
      <div class="mp-head"><span class="mp-head-ico" style="--c:${look.color}">${look.icon}</span><div class="grow"><h2>${esc(m.pin.title)}</h2><p>${look.label}${m.pin.live ? ' · <em class="mp-live">Live now</em>' : ''}</p></div></div>
      ${m.pin.sub ? `<p class="mp-text">${esc(m.pin.sub)}</p>` : ''}
      <p class="muted small">${treasure ? `Somewhere in the gold circle around ${esc(shortName(near.name))}. The exact spot stays hidden: ride there and search.` : `${person ? 'Near' : 'At'} ${esc(shortName(near.name))} · ${distText(dist(you, m))} from you`}</p>
      ${person ? '<p class="muted small">Riders only appear on the map when they choose to share where they are.</p>' : ''}
      <div class="mp-acts">
        ${m.pin.open ? `<button class="btn btn-primary" data-act="open">Open</button>` : ''}
        <button class="btn ${m.pin.open ? 'btn-ghost' : 'btn-primary'}" data-act="ride">${icons.bike} ${person ? 'Ride to them' : 'Ride there'}</button>
      </div>
      ${treasure ? '' : `<div class="mp-acts mp-acts-sm"><button class="btn btn-ghost btn-sm" data-act="dir">${icons.directions} Directions</button></div><div id="mpDir"></div>`}`, (b) => {
      bindActs(b, {
        open: () => m.pin.open?.(),
        ride: () => rideTo(near),
        dir: () => directionsTo(m.x, m.z, near.name, b.querySelector('#mpDir')!),
      });
    });
    if (fly) view.focus(m.x, m.z, Math.max(view.scale, 1.4), sheetOffset());
    else ensureVisible(m.x, m.z);
  }

  function openHidden(pl: Place) {
    selected = { kind: 'point', x: pl.x, z: pl.z };
    path = null;
    const near = nearestPlace(map, pl.x, pl.z, ['landmark', 'hall', 'academic', 'food', 'sport']);
    openSheet(`
      <div class="mp-head"><span class="mp-head-ico" style="--c:#0b1530">${icons.question}</span><div class="grow"><h2>Undiscovered spot</h2><p>Hidden location · near ${esc(shortName(near.name))}</p></div></div>
      <p class="mp-text">Something worth finding is here. Ride to it to reveal what it is and add it to your campus collection.</p>
      <div class="mp-facts"><span><b>${distText(dist(you, pl))}</b><small>from you</small></span><span><b>+${HIDDEN_XP} XP</b><small>when found</small></span></div>
      <div class="mp-acts"><button class="btn btn-primary" data-act="ride">${icons.bike} Ride to find it</button></div>`, (b) => bindActs(b, { ride: () => rideTo(pl) }));
    ensureVisible(pl.x, pl.z);
  }

  function openHunt(fly = false) {
    const t = treasureArea();
    if (!t) return;
    selected = null;
    path = null;
    const wk = treasureWeek(p);
    const home = map.hallPlace(p.hall);
    openSheet(`
      <div class="mp-head"><span class="mp-head-ico" style="--c:${GOLD}">${fx.chest}</span><div class="grow"><h2>Treasure hunt</h2><p>This week · ${wk.found} of ${TREASURE_GOAL} chests found</p></div></div>
      <p class="mp-text">Gold chests are hidden on the way from ${home ? esc(shortName(home.name)) : 'your hall'} into the gold circle. The map won't show the exact spots: ride the hunt and keep your eyes open.</p>
      <div class="mp-acts"><button class="btn btn-primary" data-act="hunt">${fx.chest} Go treasure hunting</button></div>`, (b) => bindActs(b, { hunt: () => treasureScreen(() => goTab('map')) }));
    if (fly) view.fit([{ x: t.x - t.r, z: t.z - t.r }, { x: t.x + t.r, z: t.z + t.r }], pads(), 1.4);
  }

  function openYou() {
    selected = null;
    path = null;
    const near = nearestPlace(map, you.x, you.z);
    const src = you.source === 'gps' ? "From your phone's location." : you.source === 'ride' ? `Where your last ride ended${you.at ? `, ${ago(you.at)}` : ''}.` : you.source === 'hall' ? 'Your hall. After your next ride, the map shows where you stopped.' : 'Pick your hall in your profile and the map starts there.';
    openSheet(`
      <div class="mp-head"><span class="mp-head-ico" style="--c:${YOU}">${icons.locate}</span><div class="grow"><h2>Your location</h2><p>${esc(map.title)} · near ${esc(shortName(near.name))}</p></div></div>
      <p class="muted small">${src}</p>
      <div class="mp-acts">
        <button class="btn btn-ghost" data-act="center">${icons.locate} Centre map</button>
        <button class="btn btn-ghost" data-act="gps">${icons.pin} Use my real location</button>
      </div>
      ${nearbyHtml(you.x, you.z)}`, (b) => {
      bindActs(b, { center: () => view.focus(you.x, you.z, Math.max(view.scale, 1.4), sheetOffset()), gps: () => $('mpLocate').click() });
      bindNearby(b);
    });
  }

  function openPoint(x: number, z: number) {
    selected = { kind: 'point', x, z };
    path = null;
    const near = nearestPlace(map, x, z);
    const [lat, lng] = map.toLatLng(x, z);
    openSheet(`
      <div class="mp-head"><span class="mp-head-ico" style="--c:#ea4335">${icons.pin}</span><div class="grow"><h2>Dropped pin</h2><p>Near ${esc(shortName(near.name))} · ${lat.toFixed(5)}, ${lng.toFixed(5)}</p></div></div>
      <div class="mp-facts"><span><b>${distText(dist(you, { x, z }))}</b><small>from you</small></span><span><b>${distText(dist(near, { x, z }))}</b><small>to ${esc(shortName(near.name))}</small></span></div>
      <div class="mp-acts"><button class="btn btn-primary" data-act="ride">${icons.bike} Ride here</button><button class="btn btn-ghost" data-act="dir">${icons.directions} Directions</button></div>
      <div class="mp-acts mp-acts-sm"><a class="btn btn-ghost btn-sm" href="${gmaps(x, z)}" target="_blank" rel="noopener">${icons.map} Google Maps</a></div>
      <div id="mpDir"></div>`, (b) => bindActs(b, { ride: () => rideTo(near), dir: () => directionsTo(x, z, near.name, b.querySelector('#mpDir')!) }));
    ensureVisible(x, z);
  }

  // ---------- campus collection ----------
  const refreshDex = () => {
    const pr = progress(map, p);
    $('mpDexN').textContent = String(pr.found);
    const ready = readyCount(map, p);
    const dot = $('mpDex').querySelector('.mp-dot');
    if (ready && !dot) $('mpDex').querySelector('.mp-dex-bar')!.insertAdjacentHTML('beforebegin', `<em class="mp-dot">${ready}</em>`);
    else if (dot) ready ? (dot.textContent = String(ready)) : dot.remove();
  };
  const openDex = () => {
    selected = null;
    path = null;
    const pr = progress(map, p);
    const ms = milestones(map, p);
    const icon2 = (k: string) => (icons as Record<string, string>)[k] ?? (fx as Record<string, string>)[k] ?? icons.pin;
    const reward = (r: { coins?: number; xp?: number; diamonds?: number }) => [r.coins ? `${fmt(r.coins)} ${icons.coin}` : '', r.diamonds ? `${r.diamonds} diamond${r.diamonds === 1 ? '' : 's'}` : '', r.xp ? `${r.xp} XP` : ''].filter(Boolean).join(' + ');
    openSheet(`
      <div class="mp-head"><span class="mp-head-ico" style="--c:${LANDMARK}">${fx.medal}</span><div class="grow"><h2>Campus collection</h2><p>${esc(map.title)}</p></div></div>
      <div class="mp-dex-big"><b>${pr.found}</b><span>/ ${pr.total} discovered</span><div class="mp-dex-bar"><i style="width:${(pr.found / pr.total) * 100}%"></i></div></div>
      <p class="muted small">Ride to a place to discover it (Ride here, or Explore). Finish an official route to collect it. Hidden spots show as ${icons.question} on the map.</p>
      <div class="mp-groups">
        ${pr.groups.map((g) => `<details class="mp-group"><summary><span class="mp-r-ico" style="--c:${g.group.hidden ? '#0b1530' : LANDMARK}">${icon2(g.group.icon)}</span><span class="grow"><b>${esc(g.group.name)}</b><span class="mp-mini"><i style="width:${(g.found.length / g.total) * 100}%"></i></span></span><b>${g.found.length} / ${g.total}</b></summary>
          <div class="mp-group-list">${g.group.places.map((pl) => {
            const got = g.found.includes(pl);
            return `<button class="mp-gi${got ? ' got' : ''}" data-place="${esc(pl.name)}">${got ? icons.check : g.group.hidden ? icons.question : '<i class="mp-dotty"></i>'}<span>${got || !g.group.hidden ? esc(shortName(pl.name)) : 'Undiscovered spot'}</span></button>`;
          }).join('')}</div></details>`).join('')}
        <details class="mp-group"><summary><span class="mp-r-ico" style="--c:#1a73e8">${fx.route}</span><span class="grow"><b>Official routes</b><span class="mp-mini"><i style="width:${(pr.routes.found / pr.routes.total) * 100}%"></i></span></span><b>${pr.routes.found} / ${pr.routes.total}</b></summary>
          <div class="mp-group-list">${MAP_ROUTES.map((r) => `<button class="mp-gi${p.bestTimes?.[r.id] !== undefined ? ' got' : ''}" data-route="${r.id}">${p.bestTimes?.[r.id] !== undefined ? icons.check : '<i class="mp-dotty"></i>'}<span>${esc(r.name)}</span></button>`).join('')}</div></details>
      </div>
      <p class="mp-label">Rewards</p>
      <div class="mp-rewards">${ms.map((m) => `<div class="mp-reward${m.claimed ? ' done' : m.ready ? ' ready' : ''}">
        <span class="grow"><b>${esc(m.label)}</b><small>${reward(m.reward)}</small><span class="mp-mini"><i style="width:${(m.got / m.goal) * 100}%"></i></span></span>
        ${m.claimed ? `<span class="mp-ok">${icons.check} Claimed</span>` : m.ready ? `<button class="btn btn-primary btn-sm" data-claim="${m.id}">Claim</button>` : `<small class="muted">${m.got} / ${m.goal}</small>`}
      </div>`).join('')}</div>`, (b) => {
      b.querySelectorAll<HTMLElement>('[data-claim]').forEach((el) => el.addEventListener('click', () => {
        const r = claimMilestone(map, p, el.dataset.claim!);
        if (r) banner(`${fx.medal} <b>Reward claimed:</b> ${reward(r)}`, [], 4000);
        refreshDex();
        openDex();
      }));
      b.querySelectorAll<HTMLElement>('[data-place]').forEach((el) => el.addEventListener('click', () => {
        const pl = map.placeByName(el.dataset.place!);
        if (!pl) return;
        if (isHidden(map, pl.name) && !(p.visited ?? []).includes(pl.name)) { openHidden(pl); view.focus(pl.x, pl.z, Math.max(view.scale, 1.2), sheetOffset()); }
        else openPlace(pl, true);
      }));
      b.querySelectorAll<HTMLElement>('[data-route]').forEach((el) => el.addEventListener('click', () => openRoute(MAP_ROUTES.find((r) => r.id === el.dataset.route)!, true)));
    });
  };
  $('mpDex').addEventListener('click', openDex);

  // ---------- layers: style, options, legend ----------
  $('mpLayers').addEventListener('click', () => {
    selected = null;
    path = null;
    const styleBtn = (id: MapStyle, label: string) => `<button class="mp-style${prefs.style === id ? ' on' : ''}" data-style="${id}"><span class="mp-swatch s-${id}"></span>${label}</button>`;
    const toggle = (id: string, label: string, val: boolean) => `<label class="mp-toggle"><span class="grow">${label}</span><input type="checkbox" data-opt="${id}" ${val ? 'checked' : ''}><i></i></label>`;
    const leg = (svg: string, color: string, label: string, ring = '#fff') => `<span class="mp-leg"><span class="mp-leg-ico" style="--c:${color};--r:${ring}">${svg}</span>${label}</span>`;
    openSheet(`
      <div class="mp-head"><span class="mp-head-ico" style="--c:#344054">${icons.layers}</span><div class="grow"><h2>Map style</h2><p>How the campus looks</p></div></div>
      <div class="mp-styles">${styleBtn('standard', 'Standard')}${styleBtn('terrain', 'Terrain')}${styleBtn('night', 'Night')}</div>
      ${toggle('names', 'Place and street names', prefs.names)}
      ${toggle('territories', 'Hall colours', prefs.territories)}
      <p class="mp-label">Legend</p>
      <div class="mp-legend">
        ${leg('', YOU, 'You')}
        ${leg(icons.bike, PIN_LOOK.rider.color, 'Riders')}
        ${leg(icons.user, PIN_LOOK.friend.color, 'Friends')}
        ${leg(icons.social, PIN_LOOK.crew.color, 'Crews')}
        ${leg(icons.flag, PIN_LOOK.challenge.color, 'Challenges')}
        ${leg(icons.events, PIN_LOOK.event.color, 'Events')}
        ${leg(fx.chest, GOLD, 'Treasure area')}
        ${leg(fx.starFill, LANDMARK, 'Landmark found', GOLD)}
        ${leg(icons.star, '#fff', 'Landmark to find', LANDMARK)}
        ${leg(icons.question, '#0b1530', 'Hidden spot', '#ffd21f')}
        ${leg(icons.bed, map.halls.find((x) => x.id === p.hall)?.color ?? '#c8102e', 'Halls')}
        ${leg(icons.flag, '#1a73e8', 'Route start')}
      </div>
      <p class="muted small">${esc(map.attribution)}</p>`, (b) => {
      b.querySelectorAll<HTMLElement>('[data-style]').forEach((el) => el.addEventListener('click', () => {
        prefs.style = el.dataset.style as MapStyle;
        savePrefs(prefs);
        view.setStyle(prefs.style);
        root.querySelector('#mp')!.setAttribute('data-style', prefs.style);
        b.querySelectorAll('[data-style]').forEach((x) => x.classList.toggle('on', x === el));
      }));
      b.querySelectorAll<HTMLInputElement>('[data-opt]').forEach((el) => el.addEventListener('change', () => {
        if (el.dataset.opt === 'names') { prefs.names = el.checked; view.labels = el.checked; }
        if (el.dataset.opt === 'territories') prefs.territories = el.checked;
        savePrefs(prefs);
        redraw();
      }));
    });
  });
  root.querySelector('#mp')!.setAttribute('data-style', prefs.style);

  // ---------- banners: discoveries and things happening nearby ----------
  const bannerEl = $('mpBanner');
  let bannerTimer = 0;
  function banner(html: string, acts: [string, () => void][] = [], ms = 7000) {
    clearTimeout(bannerTimer);
    bannerEl.innerHTML = `<div class="grow">${html}</div>${acts.map(([l], i) => `<button class="btn btn-sm btn-primary" data-b="${i}">${esc(l)}</button>`).join('')}<button class="mp-x" data-b="x" aria-label="Dismiss">${icons.close}</button>`;
    bannerEl.hidden = false;
    bannerEl.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => b.addEventListener('click', () => {
      bannerEl.hidden = true;
      if (b.dataset.b !== 'x') acts[Number(b.dataset.b)][1]();
    }));
    bannerTimer = window.setTimeout(() => { bannerEl.hidden = true; }, ms);
  }
  const fresh = creditDiscoveries(map, p);
  if (fresh.length) {
    const xp = fresh.reduce((n, f) => n + f.xp, 0);
    const names = fresh.slice(0, 3).map((f) => esc(shortName(f.place.name))).join(', ') + (fresh.length > 3 ? ` and ${fresh.length - 3} more` : '');
    banner(`${fx.medal} <b>${fresh.every((f) => f.hidden) ? 'Secret spot discovered' : fresh.length === 1 ? 'New place discovered' : `${fresh.length} places discovered`}:</b> ${names} · +${xp} XP`, [['Collection', openDex]], 9000);
    refreshDex();
  }
  let toldNearby = false;
  function nearbyNotice() {
    if (toldNearby || fresh.length || !bannerEl.hidden) return;
    const m = pins.filter((x) => x.pin.live && (x.pin.kind === 'challenge' || x.pin.kind === 'event' || x.pin.kind === 'friend') && Math.hypot(x.x - you.x, x.z - you.z) < 700)
      .sort((a, b) => Math.hypot(a.x - you.x, a.z - you.z) - Math.hypot(b.x - you.x, b.z - you.z))[0];
    if (!m) return;
    toldNearby = true;
    banner(`${PIN_LOOK[m.pin.kind].icon} <b>${esc(m.pin.title)}</b> · ${distText(dist(you, m))} away`, [['Show', () => openPin(m, true)]], 8000);
  }

  // ---------- leaving ----------
  const stop = () => {
    ro.disconnect();
    timers.forEach(clearInterval);
    clearTimeout(bannerTimer);
    view.destroy();
  };
  root.querySelector('#mp')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && !sheet.hidden && document.activeElement !== q) closeSheet();
  });
  return stop;
}

const lineLength = (l: [number, number][]) => {
  let n = 0;
  for (let i = 1; i < l.length; i++) n += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  return n;
};

export type { Box };
