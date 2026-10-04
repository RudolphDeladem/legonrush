// Turns an OpenStreetMap export of Legon (data/legon.osm) into the game's campus data:
// the road network, building footprints, ground areas and named places.
// Places missing from OpenStreetMap are filled in from the UG Campus Map list
// (data/ug-campus-map-pois.json). Map data © OpenStreetMap contributors, ODbL.
// Usage: node scripts/osm-campus.mjs [data/legon.osm] [src/data/legon-map.json]
import { readFileSync, writeFileSync } from 'node:fs';

const [src = 'data/legon.osm', out = 'src/data/legon-map.json'] = process.argv.slice(2);
const xml = readFileSync(src, 'utf8');

// Same frame as the game: metres around Balme Library, +x east, -z north
const LAT0 = 5.6518, LNG0 = -0.1871;
const M_LAT = 110574, M_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const local = (lat, lng) => [(lng - LNG0) * M_LNG, -(lat - LAT0) * M_LAT];
const dm = (v) => Math.round(v * 10); // decimetres keep the JSON small

// ---------- parse ----------
const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w[\w:]*)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tagsOf = (body) => Object.fromEntries([...body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)].map((m) => [m[1], unescape(m[2])]));

const nodes = new Map();
const nodeTags = [];
for (const m of xml.matchAll(/<node ([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
  const a = attrs(m[1]);
  const p = local(+a.lat, +a.lon);
  nodes.set(a.id, p);
  if (m[3]) {
    const t = tagsOf(m[3]);
    if (t.name) nodeTags.push({ id: a.id, p, t });
  }
}
const ways = new Map();
for (const m of xml.matchAll(/<way ([^>]*?)>([\s\S]*?)<\/way>/g)) {
  const id = attrs(m[1]).id;
  const refs = [...m[2].matchAll(/<nd ref="(\d+)"\s*\/>/g)].map((r) => r[1]).filter((r) => nodes.has(r));
  ways.set(id, { id, refs, t: tagsOf(m[2]) });
}
const relations = [];
for (const m of xml.matchAll(/<relation ([^>]*?)>([\s\S]*?)<\/relation>/g)) {
  const members = [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"\s*\/>/g)].map((r) => ({ type: r[1], ref: r[2], role: r[3] }));
  relations.push({ members, t: tagsOf(m[2]) });
}

// ---------- roads ----------
// class: 0 main road, 1 through road, 2 residential, 3 service lane, 4 footpath
const CLASS = {
  trunk: 0, trunk_link: 0, primary: 0, primary_link: 0,
  secondary: 1, secondary_link: 1, tertiary: 1, tertiary_link: 1,
  unclassified: 2, residential: 2, living_street: 2,
  service: 3, track: 3,
  path: 4, footway: 4, pedestrian: 4, cycleway: 4,
};
const roadNodeIndex = new Map();
const roadNodes = [];
const roads = [];
for (const w of ways.values()) {
  const cls = CLASS[w.t.highway];
  if (cls === undefined || w.refs.length < 2) continue;
  if (w.t.service === 'parking_aisle' || w.t.area === 'yes' || w.t.access === 'private') continue;
  const idx = w.refs.map((r) => {
    if (!roadNodeIndex.has(r)) {
      roadNodeIndex.set(r, roadNodes.length);
      roadNodes.push(nodes.get(r));
    }
    return roadNodeIndex.get(r);
  });
  const road = { c: cls, w: idx };
  if (w.t.name) road.n = w.t.name;
  roads.push(road);
}

// ---------- polygons (buildings and ground areas) ----------
function ringsFromRelation(rel, inner = false) {
  // join outer (or inner) member ways end to end into closed rings
  const parts = rel.members.filter((m) => m.type === 'way' && (m.role === 'inner') === inner && ways.has(m.ref)).map((m) => [...ways.get(m.ref).refs]);
  const rings = [];
  while (parts.length) {
    let ring = parts.shift();
    let grown = true;
    while (ring[0] !== ring[ring.length - 1] && grown) {
      grown = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const end = ring[ring.length - 1];
        if (p[0] === end) ring = ring.concat(p.slice(1));
        else if (p[p.length - 1] === end) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        parts.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
const ringCoords = (refs) => refs.slice(0, refs[0] === refs[refs.length - 1] ? -1 : undefined).map((r) => nodes.get(r));
const centroid = (pts) => {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    const f = x0 * z1 - x1 * z0;
    a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f;
  }
  if (Math.abs(a) < 1e-6) return pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  return [cx / (3 * a), cz / (3 * a)];
};
const area = (pts) => Math.abs(pts.reduce((s, [x0, z0], i) => { const [x1, z1] = pts[(i + 1) % pts.length]; return s + x0 * z1 - x1 * z0; }, 0) / 2);

const buildings = [];
const areas = [];
const named = []; // candidate places: { name, tags, x, z, from }
const insideRing = (pts, [x, z]) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
let courtyards = 0;
const isResidence = (t) => t.tourism === 'hostel' || t.building === 'dormitory' || /\b(hall|hostel|annex)\b/i.test(t.name ?? '') && !/great hall|lecture|dining|dinning|library|assembly/i.test(t.name ?? '');
function addBuilding(pts, t, holes = []) {
  if (pts.length < 3) return;
  const levels = parseFloat(t['building:levels']);
  const height = parseFloat(t.height);
  const b = { p: pts.flatMap(([x, z]) => [dm(x), dm(z)]) };
  if (height > 0) b.h = Math.round(height);
  else if (levels > 0) b.h = Math.round(levels * 3.4 + 1);
  else if (isResidence(t)) b.h = Math.round((/valco/i.test(t.name ?? '') ? 3 : area(pts) > 1200 ? 4 : 3) * 3.4 + 1); // Valco: 3 storeys (meqasa); other halls estimated by size
  if (t.name) b.n = t.name;
  if (holes.length) { b.i = holes.map((hp) => hp.flatMap(([x, z]) => [dm(x), dm(z)])); courtyards += holes.length; }
  buildings.push(b);
  if (t.name) { const [x, z] = centroid(pts); named.push({ name: t.name, t, x, z, from: 'building', size: area(pts) }); }
}
const AREA_KIND = (t) =>
  t.leisure === 'pitch' || t.leisure === 'stadium' ? 'pitch'
  : t.leisure === 'track' || t.leisure === 'sports_centre' ? 'track'
  : t.amenity === 'parking' ? 'parking'
  : t.natural === 'water' || t.leisure === 'swimming_pool' ? 'water'
  : t.natural === 'wood' || t.landuse === 'forest' ? 'wood'
  : null;
for (const w of ways.values()) {
  if (w.refs.length < 4 || w.refs[0] !== w.refs[w.refs.length - 1]) continue;
  const pts = ringCoords(w.refs);
  if (w.t.building && w.t.building !== 'construction' && w.t.building !== 'roof') addBuilding(pts, w.t);
  else if (AREA_KIND(w.t)) areas.push({ k: AREA_KIND(w.t), p: pts.flatMap(([x, z]) => [dm(x), dm(z)]) });
  else if (w.t.name && (w.t.amenity || w.t.leisure || w.t.tourism || w.t.landuse === 'education')) { const [x, z] = centroid(pts); named.push({ name: w.t.name, t: w.t, x, z, from: 'area', size: area(pts) }); }
}
for (const rel of relations) {
  if (rel.t.type !== 'multipolygon') continue;
  const rings = ringsFromRelation(rel);
  const inners = ringsFromRelation(rel, true).map(ringCoords);
  for (const r of rings) {
    const pts = ringCoords(r);
    if (rel.t.building) addBuilding(pts, rel.t, inners.filter((h) => insideRing(pts, h[0])));
    else if (AREA_KIND(rel.t)) areas.push({ k: AREA_KIND(rel.t), p: pts.flatMap(([x, z]) => [dm(x), dm(z)]) });
  }
  if (!rel.t.building && rel.t.name && rings.length) { const [x, z] = centroid(ringCoords(rings[0])); named.push({ name: rel.t.name, t: rel.t, x, z, from: 'area', size: area(ringCoords(rings[0])) }); }
}
// trotro lines that stop at each node (route=bus relations)
const linesAt = new Map();
const lineEnds = {}; // ref -> the places the line runs between
for (const rel of relations) {
  if (rel.t.type !== 'route' || rel.t.route !== 'bus' || !rel.t.ref) continue;
  lineEnds[rel.t.ref] = [...new Set([...(lineEnds[rel.t.ref] ?? []), rel.t.from, rel.t.to].filter(Boolean))];
  for (const m of rel.members) if (m.type === 'node') linesAt.set(m.ref, new Set([...(linesAt.get(m.ref) ?? []), rel.t.ref]));
}
for (const { id, p, t } of nodeTags) {
  if (t.amenity || t.shop || t.tourism || t.office || t.leisure || t.highway === 'bus_stop' || t.building) named.push({ id, name: t.name, t, x: p[0], z: p[1], from: 'node', size: 0 });
}

// ---------- places ----------
const KIND_RULES = [
  ['landmark', (n) => /^(the )?(great hall|balme library|legon main entrance|university of ghana registry)$|quadrangle|fountain|night market/i.test(n)],
  ['worship', (n, t) => t.amenity === 'place_of_worship' || /church|mosque|chapel|kingdom hall|prayer/i.test(n)],
  ['transport', (n, t) => t.highway === 'bus_stop' || /bus_station|taxi/.test(t.amenity ?? '')],
  ['bank', (n, t) => /bank|atm|bureau_de_change|payment/.test(t.amenity ?? '') || /bank|credit union|forex/i.test(n)],
  ['food', (n, t) => /restaurant|fast_food|cafe|food_court|marketplace|pub|bar/.test(t.amenity ?? '') || /cafeteria|dining|dinning|canteen|jollof|kebab|joint|food court|food vendor|restaurant|pizza|night market/i.test(n)],
  ['hall', (n, t) => (t.tourism === 'hostel' || t.building === 'dormitory' || /\b(hall|hostel|annex|pentagon|pent|ish ?\d?|international house|valco|bani|evandy|courts)\b/i.test(n)) && !/great hall|assembly|lecture|library|ict|laundr|admin|office|isser|provost|science|family|chapel|washroom|porters/i.test(n)],
  ['health', (n, t) => /hospital|clinic|doctors|pharmacy/.test(t.amenity ?? '') || /hospital|clinic|pharmacy|\bchemist\b|medical/i.test(n)],
  ['sport', (n, t) => !!t.leisure || /stadium|sports|oval|pitch|gym|field|fitness/i.test(n)],
  ['academic', (n, t) => /university|college|school|library/.test(t.amenity ?? t.building ?? '') || /dep(artmen)?t|school|faculty|institute|centre|center|college|lab|library|lecture|jqb|block|building|studies|science|archive|chemistry|physics|statistics|math/i.test(n)],
];
const kindOf = (n, t) => (KIND_RULES.find(([, f]) => f(n, t)) ?? ['other'])[0];
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|of|and|dr|department|dept|university|ghana|legon|ug)\b/g, ' ').replace(/\s+/g, ' ').trim();
const SKIP = /^(office|offices|block [a-f]|blocke|east legon( \d+)?|18|cafeteria|rest station)$/i;
const rank = { building: 0, area: 1, node: 2, list: 3 };
named.sort((a, b) => rank[a.from] - rank[b.from] || b.size - a.size);
const places = [];
for (const c of named) {
  const name = c.name.replace(/\s+/g, ' ').trim();
  if (SKIP.test(name) || name.length < 3) continue;
  const key = norm(name);
  if (places.some((p) => (norm(p.n) === key && Math.hypot(p.x - c.x, p.z - c.z) < 300) || (Math.hypot(p.x - c.x, p.z - c.z) < 150 && norm(p.n).startsWith(key) && /^( (hall|building|block|centre|center))+$/.test(norm(p.n).slice(key.length))))) continue;
  const place = { n: name, k: kindOf(name, c.t), x: c.x, z: c.z };
  const lines = c.id && linesAt.get(c.id);
  if (lines) place.l = [...lines].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  places.push(place);
}
// fill gaps from the UG Campus Map list
const listed = JSON.parse(readFileSync('data/ug-campus-map-pois.json', 'utf8'));
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
let added = 0;
for (const poi of listed) {
  const name = poi.name.replace(/ - (Research|Educational|Training|College).*$/, '').replace(/\(ISSER$/, '(ISSER)').trim();
  const [x, z] = local(poi.lat, poi.lng);
  const w = words(name);
  const match = places.some((p) => {
    if (Math.hypot(p.x - x, p.z - z) > 250) return false;
    const pw = words(p.n);
    const common = [...w].filter((v) => pw.has(v)).length;
    return common / Math.max(1, Math.min(w.size, pw.size)) >= 0.6;
  });
  if (match) continue;
  places.push({ n: name, k: kindOf(name, {}), x, z, src: 'ug-campus-map' });
  added++;
}

// same name in several spots (banks, canteens): add the nearest well-known place
const ANCHOR = new Set(['landmark', 'hall', 'academic', 'sport', 'health']);
const byName = new Map();
for (const p of places) byName.set(p.n, [...(byName.get(p.n) ?? []), p]);
let renamed = 0;
for (const [name, list] of byName) {
  if (list.length < 2) continue;
  for (const p of list) {
    let best = null, bd = Infinity;
    for (const q of places) {
      if (q.n === name || !ANCHOR.has(q.k) || byName.get(q.n).length > 1 || q.n.length > 28) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = q; }
    }
    if (best) { p.n = `${name} (near ${best.n.replace(/^The /, '')})`; renamed++; }
  }
}
// still clashing (same anchor): number them
const seen = new Map();
for (const p of places) { const c = (seen.get(p.n) ?? 0) + 1; seen.set(p.n, c); if (c > 1) p.n = `${p.n} ${c}`; }

// corrections to names on the map
const RENAME = { 'James Quartey Building, JQB': 'Jones Quartey Building, JQB' }; // JQB is the Jones Quartey Building
for (const p of places) if (RENAME[p.n]) p.n = RENAME[p.n];

const json = {
  attribution: 'Map data © OpenStreetMap contributors (ODbL). Extra places from the UG Campus Map by enkayyy97.',
  origin: [LAT0, LNG0],
  nodes: roadNodes.flatMap(([x, z]) => [dm(x), dm(z)]),
  roads,
  buildings,
  areas,
  lines: lineEnds,
  places: places.map((p) => ({ n: p.n, k: p.k, x: dm(p.x), z: dm(p.z), ...(p.l && { l: p.l }) })),
};
writeFileSync(out, JSON.stringify(json));
console.log(`courtyards ${courtyards}, renamed ${renamed} same-name places`);
console.log(`roads ${roads.length} (nodes ${roadNodes.length}), buildings ${buildings.length}, areas ${areas.length}, places ${places.length} (+${added} from the UG Campus Map), ${(JSON.stringify(json).length / 1024).toFixed(0)} KB`);
