# LEGONRUSH

**The Campus Lifestyle Reimagined. Ride. Race. Connect.**

A browser-based 3D cycling game set on the University of Ghana, Legon campus, delivered as an installable Progressive Web App (PWA). This repository holds the MVP prototype (phase 1 of the product spec).

## Site

- `/` is the landing page (DELA's design and logo)
- `/play/` is the game; every "Get started" button leads there, and the installed app opens straight into it

## What's playable now

- Splash → Welcome → Create Rider (name, username, hall) → Choose Starter Bike → tutorial first ride → Results → Home
- Guest play (skip sign-up, create a rider later)
- **Quick Ride on the Campus Loop (3.3 km)**: 3-lane arcade runner with cars, trotros, pedestrians, barriers and potholes, Rush Coins, a boost meter, score, distance, finish line and results
- A curving road through the real campus, from Valco Trust and Mensah Sarbah past Legon Hall, Commonwealth Hall and the Great Hall, then east past Volta Hall, Balme Library and JQB to the School of Law, with a heading-up mini map
- 24 real buildings as labelled boxes at their real positions, plus unlabelled blocks for the rest of the campus
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
  data/campus.ts     halls, route, landmarks, bikes  <- edit here to refine the map
  game/Game.ts       game loop, rider physics, spawning, collisions, camera
  game/world.ts      road, trees, lamps, buildings, landmarks, billboards
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

Building positions come from the [UG Campus Map](https://enkayyy97.github.io/ug-campus-map/) by enkayyy97 and live in `src/data/ugmap.ts` (latitude and longitude, projected to metres around Balme Library). The route is a list of waypoints between those buildings (`CAMPUS_LOOP_PATH`); `src/game/track.ts` smooths it into a road and everything in the world is placed by distance along it. That map has no road data, so the road between buildings is approximate. Next step: trace the real roads from OpenStreetMap and swap the waypoints.

## Roadmap (from the product spec)

1. **MVP** (this repo): one zone, one bike class, solo Quick Ride, score, results, basic profile
2. Multiple routes, real campus layout, garage and bikes, accounts (Supabase), leaderboards
3. 10-player real-time races, private rooms with codes, social riding
4. Events, hall competitions, Together mode, live population
5. Vehicles, economy expansion, in-world brand billboards and sponsored events
