# WheelPath

Accessibility-first pedestrian navigation for wheelchair users. Research prototype built with **Next.js, React, TypeScript and Node.js**, focused on the streets around Valenzuela City School of Mathematics and Science (A. Pablo St, Valenzuela City).

## What is real and what is simulated

| Real | Simulated (labelled in the app) |
|---|---|
| Street and path geometry, street names, places (OpenStreetMap) | Sidewalk widths, slopes, surfaces, curb ramps |
| Base map tiles (OpenFreeMap, from OpenStreetMap data) | The 9 hazard reports and their comments |
| Your phone's location, if you turn it on | The demo starting position |

Simulated values exist only inside a 500 m circle around the school, and are generated deterministically from OpenStreetMap way IDs, so everyone sees the same values. Stretches with no data are never rated accessible. **This is not a field survey.** The scoring thresholds are prototype defaults and must be confirmed against the NCDA 2024 Revised IRR checklist (BP 344).

## Run it

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

Production build: `npm run build` then `npm start`.

To use your phone's GPS, open the app over **https** (browsers only allow location on secure pages, or on `localhost`).

## Street data

The server loads streets in this order:

1. `data/osm-snapshot.json` (committed with the app, so it works without any outside server),
2. a cache in the system temp folder (7 days),
3. the public Overpass servers (`overpass-api.de`, `overpass.private.coffee`, `maps.mail.ru`), identifying itself with a User-Agent.

Refresh the snapshot with `npm run fetch-streets` (retries with back-off when the servers are busy). The data is © OpenStreetMap contributors, ODbL; keep the attribution visible.

## Deploy

- **Vercel**: import the GitHub repo; no settings needed.
- **Any Node host** (Render, Railway, a VPS): `npm run build`, then run `node .next/standalone/server.js` after copying `.next/static` to `.next/standalone/.next/static` and `data/` to `.next/standalone/data` (or just `npm start`).
- Optional environment variables are listed in `.env.example` (map style URL, Overpass User-Agent).

Before a public pilot, check the current terms of OpenFreeMap and the Overpass servers; they are free public services, not guaranteed production APIs.

## Code map

```
src/lib/config.ts              focus area, map style URL
src/lib/engine/types.ts        GIS types (GeoJSON [lng, lat] order)
src/lib/engine/rules.ts        accessibility rules and labels (prototype defaults)
src/lib/engine/build.ts        OSM -> routing network + simulated accessibility layer
src/lib/engine/engine.ts       scoring, snapping, weighted Dijkstra, alternatives, turn-by-turn
src/lib/server/streets.ts      server-only street loading (snapshot, cache, Overpass)
src/app/api/streets/route.ts   GET /api/streets -> the network as JSON
src/components/MapView.tsx     MapLibre map and GIS layers
src/components/WheelPathApp.tsx screens: map, search, route, navigation, arrival, reports, report form, preferences, about
src/hooks/useGeolocation.ts    browser location with visible states (off, requesting, active, denied, unavailable)
legacy/index.html              the earlier single-file prototype
```

In the browser console, `window.wheelpath.engine` exposes the routing engine for inspection.

## Not built yet

- Sharing hazard reports between users in real time (planned: Node API + PostgreSQL/PostGIS + Socket.IO). Reports are saved in each browser for now.
- Importing real survey data (GeoJSON of segments with width, slope, surface; curb-ramp points; hazards) in place of the simulated layer.
- Accounts and sign-in.
