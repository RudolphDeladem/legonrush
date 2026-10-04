# LEGONRUSH

**The Campus Lifestyle Reimagined. Ride. Race. Connect.**

A browser-based 3D cycling game set on the University of Ghana, Legon campus, delivered as an installable Progressive Web App (PWA). This repository holds the MVP prototype (phase 1 of the product spec).

## Site

- `/` is the landing page (DELA's design and logo)
- `/play/` is the game; every "Get started" button leads there, and the installed app opens straight into it

## What's playable now

- Splash → Welcome → Create Rider (name, username, hall) → Choose Starter Bike → tutorial first ride → Results → Home
- Guest play (skip sign-up, create a rider later)
- **The real campus from OpenStreetMap**: every road and footpath, 1,600 building footprints at their real positions and sizes, pitches, parking and water, and 400+ named places
- **Explore**: pick where you are and where you need to be (for example Limann Hall to the School of Law or Pent), see the real shortest way on a map with distance, walking and cycling time and turn-by-turn directions, then ride it with a direction banner, place labels and a heading-up mini map. Built so freshers can learn their way around. Routes can be shared as a link (or on WhatsApp) and opened in Google Maps; each destination gets a card with what it is, what is nearby and the nearest trotro stop.
- **Freshers' Tour**: one 3.5 km ride past Night Market, Central Cafeteria, JQB, the Balme Library, the Business School, the Registry and the Great Hall
- **Where is it?**: five campus places, tap the map where you think each one is, earn coins
- First-draft landmark models: the Balme Library clock tower, the Great Hall tower, the main gate and the Night Market stalls
- **Quick Ride, Limann to Great Hall (2.6 km)**: 3-lane arcade runner on the real roads with cars, trotros, pedestrians, barriers and potholes, Rush Coins, a boost meter, score, distance, finish line and results
- Real halls of residence to represent; jersey colour follows your hall
- Home hub, Ride, Race (coming soon), Events (coming soon) and You (profile + stats)
- Progress, coins, XP and levels saved on the device
- Installable and works offline after the first load

## Controls

| | Keyboard | Touch |
|---|---|---|
| Change lane | ← → or A D | Swipe left / right |
| Jump | ↑, W or Space | Swipe up |
| Boost | B or Shift | Tap, or the Boost button |
| Pause | Esc or P | Pause button |

Jump over barriers and potholes. Dodge cars, trotros and pedestrians. Potholes slow you down; everything else ends the ride, unless you are boosting.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN for testing on a phone)
npm run build      # typecheck + production build in dist/
npm run preview    # serve the production build (PWA/service worker active)
```

Deploys to Netlify from `main` using `netlify.toml` (build `npm run build`, publish `dist`).

Requires Node 20+.

## Project layout

```
src/
  main.ts            screens and app flow (splash, onboarding, hub, HUD, results)
  style.css          design language: navy/black, gold accent, bold geometric type
  state.ts           profile, levels, rewards (localStorage)
  audio.ts           tiny WebAudio sound effects
  data/campus.ts     halls, bikes, upcoming routes
  data/legon-map.json  campus roads, buildings, areas and places (generated from OpenStreetMap)
  game/campusmap.ts  loads the map, road graph, shortest path (A*), turn-by-turn directions
  game/routes.ts     rides along real roads (Quick Ride, Explore)
  game/track.ts      smooths a route into a rideable road; position by distance along it
  game/Game.ts       game loop, rider physics, spawning, collisions, camera
  game/world.ts      the 3D campus (roads, buildings, areas, trees) and the route layer (labels, gates, lamps)
  ui/mapview.ts      2D mini map and route preview
  game/models.ts     rider, bike, vehicles, obstacles, coins
  game/textures.ts   procedural textures (no image downloads)
  landing/            landing page script and styles
index.html           landing page
play/index.html      game page
public/brand/        logo, wordmark and social image
public/icons/        app icons cut from the logo
public/photos/       landing-page photos (WebP) cut from DELA's originals by scripts/landing-photos.mjs
public/art/          SVG illustrations (avatars in use; the rest are a fallback set from scripts/landing-art.mjs)
public/shots/        in-game screenshots (marketing renders)
scripts/             brand-assets.mjs (logo -> icons), landing-photos.mjs (photos -> WebP), landing-art.mjs (SVG illustrations), marketing-shots.mjs (game renders); the PNG ones need Playwright
```

## The campus map

The campus comes from an OpenStreetMap export of Legon (`data/legon.osm`, © OpenStreetMap contributors, ODbL). `node scripts/osm-campus.mjs` turns it into `src/data/legon-map.json`: roads by class, building footprints and heights, areas, and named places, projected to metres around Balme Library. 38 extra place names come from the [UG Campus Map](https://enkayyy97.github.io/ug-campus-map/) by enkayyy97 (`data/ug-campus-map-pois.json`). To refresh the map, export the same area again from openstreetmap.org, replace `data/legon.osm` and rerun the script. Missing or misplaced buildings are best fixed on OpenStreetMap itself, which also helps everyone else.

## Roadmap (from the product spec)

1. **MVP** (this repo): one zone, one bike class, solo Quick Ride, score, results, basic profile
2. Multiple routes, real campus layout, garage and bikes, accounts (Supabase), leaderboards
3. 10-player real-time races, private rooms with codes, social riding
4. Events, hall competitions, Together mode, live population
5. Vehicles, economy expansion, in-world brand billboards and sponsored events
