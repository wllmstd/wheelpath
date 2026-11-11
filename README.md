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

## How the GIS works

- **Everything is GeoJSON in [lng, lat].** Pathways, hazards, places and routes are MapLibre GeoJSON sources drawn by map layers, so zooming, panning and rotating never move them off their location.
- **Hazards have fixed geometry**: a `Point`, a `LineString` (a blocked stretch) or a `Polygon` (an affected area). The engine attaches each one to the pathway stretches it touches (`Engine.spansFor`): a point to the nearest pathway within 20 m, a line to stretches within 6 m of it, a polygon to stretches inside it. Scoring, routing costs, barriers and the 25 m buffer all use these stretches. A user report keeps the exact point that was picked; it is not moved onto the path.
- **Places** are the real OpenStreetMap features at their mapped coordinates, with whatever OSM records (address, opening hours, phone, website, `wheelchair=*` tag). "Set as destination" routes from the current starting position.
- **Live location** uses `watchPosition()` while it is switched on and clears the watch when it is switched off or the page closes. The raw GPS fix is shown as the blue dot with its accuracy circle; the matched point on the pedestrian network is a separate teal dot. If permission is denied or the position is unavailable, WheelPath says so and does not switch to the demo position on its own. Outside the area with data, the real position is shown but routes are not rated.
- **Navigation**: with live GPS, each fix is projected onto the route; two fixes more than 30 m off trigger a new route from the raw position. In demo mode, simulated time advances along the route's own geometry at the engine's wheelchair travel speeds (slower on slopes and rough surfaces), with pause, resume, stop, arrival, and a "Simulate a wrong turn" action that leaves the path onto a real side street and re-routes.
- **Data sources** are labelled on every value: Simulated, User report or Surveyed (the last is reserved for field data).

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
src/lib/engine/engine.ts       hazard spatial join, scoring, snapping, weighted Dijkstra, alternatives, turn-by-turn, positions along a route
src/lib/server/streets.ts      server-only street loading (snapshot, cache, Overpass)
src/app/api/streets/route.ts   GET /api/streets -> the network as JSON
src/components/MapView.tsx     MapLibre map: GeoJSON layers for pathways, hazards, places, routes, GPS position
src/components/WheelPathApp.tsx screens: map, search, route, navigation, arrival, reports, report form, preferences, about
src/hooks/useGeolocation.ts    watchPosition() with visible states (off, requesting, active, denied, unavailable), retry and cleanup
legacy/index.html              the earlier single-file prototype
```

In the browser console, `window.wheelpath.engine` exposes the routing engine and `window.wheelpathMap` the MapLibre map, for inspection.

## Not built yet

- Sharing hazard reports between users in real time (planned: Node API + PostgreSQL/PostGIS + Socket.IO). Reports are saved in each browser for now.
- Importing real survey data (GeoJSON of segments with width, slope, surface; curb-ramp points; hazards) in place of the simulated layer.
- Accounts and sign-in.
