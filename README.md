# LEGONRUSH

**The Campus Lifestyle Reimagined. Ride. Race. Connect.**

A browser-based 3D cycling game set on the University of Ghana, Legon campus, delivered as an installable Progressive Web App (PWA). This repository holds the MVP prototype (phase 1 of the product spec).

## What's playable now

- Splash → Welcome → Create Rider (name, username, hall) → Choose Starter Bike → tutorial first ride → Results → Home
- Guest play (skip sign-up, create a rider later)
- **Quick Ride on the Campus Loop (2.8 km)**: 3-lane arcade runner with cars, trotros, pedestrians, barriers and potholes, Rush Coins, a boost meter, score, distance, finish line and results
- Campus landmarks as labelled boxes (Main Gate, Commonwealth Hall, Great Hall, Legon Hall, Balme Library, Akuafo Hall, JQB, Volta Hall, Mensah Sarbah Hall, Night Market, UGBS and the four newer halls)
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
public/icons/        app icons (regenerate with `npm run icons`, needs Playwright)
```

## Refining the campus map

Landmark positions in `src/data/campus.ts` are placeholders on one straight road. The next step is tracing the real road layout and building footprints from Google Maps or OpenStreetMap and replacing the boxes one landmark at a time.

## Roadmap (from the product spec)

1. **MVP** (this repo): one zone, one bike class, solo Quick Ride, score, results, basic profile
2. Multiple routes, real campus layout, garage and bikes, accounts (Supabase), leaderboards
3. 10-player real-time races, private rooms with codes, social riding
4. Events, hall competitions, Together mode, live population
5. Vehicles, economy expansion, in-world brand billboards and sponsored events
