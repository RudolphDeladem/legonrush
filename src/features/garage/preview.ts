// The 3D bike in a page: a see-through "stage" box that the Garage camera frames the bike inside.
// Drag to turn it, pinch / scroll / buttons to zoom, quick angles, bike-only view and time of day.
import type { BikeStyle } from '../../game/models';
import { icons } from '../../ui/icons';
import { H, esc } from '../host';
import { saveProfile } from '../../state';

type Scene = 'day' | 'sunset' | 'night';
const view = { yaw: Math.PI * 0.62, zoom: 1, rider: false, spin: true };
const ANGLES: Record<string, [string, number]> = { side: ['Side', Math.PI / 2], front: ['Front', Math.PI * 0.92], rear: ['Rear', 0.08], three: ['3/4', Math.PI * 0.68] };

let stop: (() => void) | null = null;
/** stops the current stage (its listeners); call before drawing a page without one */
export function unmountStage() {
  stop?.();
  stop = null;
}

/** the controls drawn inside a stage box */
export function stageControls(opts: { angles?: boolean; rider?: boolean; scene?: boolean } = {}) {
  const scene = (H().profile().garage.scene || 'day') as Scene;
  return `<div class="gx-hole" aria-hidden="true"></div>
    <div class="gx-ctrl" role="toolbar" aria-label="Bike view">
      ${opts.angles === false ? '' : `<div class="gx-seg">${Object.entries(ANGLES).map(([k, [label]]) => `<button data-gx-angle="${k}">${label}</button>`).join('')}</div>`}
      <div class="gx-seg">
        <button data-gx-zoom="-1" aria-label="Zoom out">${icons.minus}</button>
        <button data-gx-zoom="1" aria-label="Zoom in">${icons.plus}</button>
        ${opts.rider === false ? '' : `<button data-gx-rider aria-pressed="${view.rider}" class="${view.rider ? 'on' : ''}" aria-label="Show rider">${icons.user}</button>`}
        ${opts.scene === false ? '' : `<button data-gx-scene aria-label="Time of day: ${scene}">${scene === 'night' ? icons.moon : scene === 'sunset' ? icons.sunrise : icons.sun}</button>`}
      </div>
    </div>
    <p class="gx-drag">${icons.rotate} Drag to turn</p>`;
}

/**
 * Starts the 3D view in a stage element: applies the look and keeps the camera framing the box while the
 * page scrolls or resizes. Returns a function that re-applies a new look.
 */
export function mountStage(stage: HTMLElement, style: BikeStyle) {
  unmountStage();
  const b3 = H().bike3d;
  const p = H().profile();
  b3.style(style);
  b3.scene((p.garage.scene || 'day') as Scene);
  let raf = 0;
  const apply = () => {
    raf = 0;
    if (!stage.isConnected) return unmountStage();
    const r = stage.getBoundingClientRect();
    b3.view({ rect: { x: r.left, y: r.top, w: Math.max(1, r.width), h: Math.max(1, r.height) }, yaw: view.yaw, zoom: view.zoom, spin: view.spin, rider: view.rider });
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(apply); };
  apply();
  let idle = 0;
  const hold = () => {
    if (view.spin) { view.yaw = b3.yaw(); view.spin = false; }
    clearTimeout(idle);
    idle = window.setTimeout(() => { view.yaw = b3.yaw(); view.spin = true; queue(); }, 6000);
  };
  // drag to turn, pinch to zoom
  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture?.(e.pointerId);
    hold();
  };
  const move = (e: PointerEvent) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pts.set(e.pointerId, now);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) view.zoom = clampZoom(view.zoom * (pinch / d));
      pinch = d;
    } else {
      view.yaw -= (now.x - prev.x) * 0.012;
    }
    hold();
    queue();
  };
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  const wheel = (e: WheelEvent) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 40 && !(e.target as HTMLElement).closest('.gx-stage')) return;
    e.preventDefault();
    view.zoom = clampZoom(view.zoom * (e.deltaY > 0 ? 1.1 : 0.9));
    hold();
    queue();
  };
  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', wheel, { passive: false });
  addEventListener('scroll', queue, true);
  addEventListener('resize', queue);
  stage.querySelectorAll<HTMLElement>('[data-gx-angle]').forEach((el) => el.addEventListener('click', () => {
    hold();
    view.yaw = ANGLES[el.dataset.gxAngle!][1];
    queue();
  }));
  stage.querySelectorAll<HTMLElement>('[data-gx-zoom]').forEach((el) => el.addEventListener('click', () => {
    hold();
    view.zoom = clampZoom(view.zoom * (Number(el.dataset.gxZoom) > 0 ? 0.82 : 1.22));
    queue();
  }));
  stage.querySelector<HTMLElement>('[data-gx-rider]')?.addEventListener('click', (e) => {
    view.rider = !view.rider;
    const el = e.currentTarget as HTMLElement;
    el.classList.toggle('on', view.rider);
    el.setAttribute('aria-pressed', String(view.rider));
    view.yaw = b3.yaw();
    queue();
  });
  stage.querySelector<HTMLElement>('[data-gx-scene]')?.addEventListener('click', (e) => {
    const order: Scene[] = ['day', 'sunset', 'night'];
    const next = order[(order.indexOf((p.garage.scene || 'day') as Scene) + 1) % 3];
    p.garage.scene = next;
    saveProfile(p);
    b3.scene(next);
    const el = e.currentTarget as HTMLElement;
    el.innerHTML = next === 'night' ? icons.moon : next === 'sunset' ? icons.sunrise : icons.sun;
    el.setAttribute('aria-label', `Time of day: ${esc(next)}`);
  });
  stop = () => {
    cancelAnimationFrame(raf);
    clearTimeout(idle);
    removeEventListener('scroll', queue, true);
    removeEventListener('resize', queue);
  };
  return (s: BikeStyle) => b3.style(s);
}

const clampZoom = (z: number) => Math.max(0.55, Math.min(1.8, z));

/** a short "UPGRADE COMPLETE" banner over the stage */
export function stageFlash(stage: HTMLElement | null, title: string, sub: string) {
  if (!stage) return;
  stage.querySelector('.gx-flash')?.remove();
  const el = document.createElement('div');
  el.className = 'gx-flash';
  el.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
  stage.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
