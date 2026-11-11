# WheelPath: Project Progress

Accessibility-first pedestrian navigation for wheelchair users in Valenzuela City.
Status as of November 2026.

---

## 1. Planning (research plan)

**Source:** the research plan document (`RS PLAN.docx`).

- **Goal:** help wheelchair users find the most accessible walking path, not just the shortest one.
- **Study area:** pedestrian routes in Malinta, Valenzuela City. The plan covers 9 study routes.
- **Method:** rule-based accessibility scoring of each pathway, based on a BP 344 / 2024 Revised IRR checklist.
- **What gets scored:** clear width, slope or ramp inclination, surface condition, hazards, and curb ramps at crossings.
- **Research wording kept throughout the app:**
  - hedged language, so the app never claims a path is "safe";
  - missing or unverified data is never rated accessible;
  - a critical barrier with no alternative means the path is not suitable;
  - the recommended path is the one with the highest accessibility rating.

**Prototype scoring rules.** These are defaults to confirm against the NCDA 2024 IRR checklist.

| Factor | 5 stars | 4 | 3 | 2 | 1 (critical) |
|---|---|---|---|---|---|
| Width | ≥ 1.50 m | 1.20–1.49 m | 1.00–1.19 m | 0.90–0.99 m | < 0.90 m |
| Slope | ≤ 2 % | ≤ 5 % | ≤ 8.33 % (1:12) | ≤ 10 % | > 10 % |
| Surface | Smooth | Fair | – | Rough | Broken |

A path also counts as critical, and is rated "Not accessible", if it has stairs, a missing curb ramp, or a hazard that blocks a wheelchair. If more than half of a path has no data, it is rated "Limited data".

---

## 2. Design

- **Mobile redesign:** the app was redesigned as a mobile web view, keeping the original WheelPath colours: teal `#1C747C`, navy `#2C344C`, aqua `#94DCE4` and pale `#E4F7F8`.
- **Design canvas:** a "more human, clean and organized" design canvas of the 8 core screens, published as a private artifact: https://claude.ai/artifact/B2aPCh9DpJEsVhGXcUY3zD
- **Screens designed:**
  - log in and sign up
  - preferences
  - map home
  - search
  - route result with the path comparison
  - navigation
  - arrival rating
  - reports and report details
  - contacting the authorities

---

## 3. Development

### Phase A: Interactive GIS prototype (sample data)

- **What it is:** a single-page interactive prototype with a small GIS engine behind it, published privately at https://claude.ai/artifact/VYBoMYTtuwF1R2q7NNvCpj
- **Data:** sample data placed around Malinta (a street grid, 9 sample corridors, places and hazards). Labelled as sample data, not a field survey.
- **Engine:**
  - snapping your position to the nearest pathway
  - scoring each pathway with the rules above
  - weighted shortest-path routing with alternative paths
  - 25 m hazard buffers
  - turn-by-turn directions
- **Interactive:** your preferences change which path is recommended, you can drag yourself around the map, and a new report re-rates the path.
- **GIS inspector:** a side panel showing what the engine computes as you use the app.

### Phase B: Live map version (single hosted file)

- **Focus:** moved to Valenzuela City School of Mathematics and Science, A. Pablo St (14.69198 N, 120.96665 E).
- **Real:** streets and place names from OpenStreetMap, drawn over OpenStreetMap map tiles.
- **Simulated, and labelled so:**
  - widths, slopes, surfaces and curb ramps inside a 500 m circle;
  - 9 hazards with reports, such as broken pavement at the school gate, an open drain, and parked tricycles blocking the walkway.
- **Problem found:** first tests on Netlify failed because the public street servers (Overpass) were overloaded.
- **Fix:** a faster loader that tries several servers and falls back to a saved street-data file, plus hosting notes.

### Phase C: Next.js + React + TypeScript app (current)

- **Where:** your repository, `Documents/GitHub/wheelpath`, now pushed to GitHub.
- **Stack:** follows your GIS stack document: Next.js 16, React 19, TypeScript, MapLibre GL with OpenFreeMap map tiles, and browser location.
- **Decisions:**
  - Milestone 1 ports the prototype, with no database yet.
  - Real-time updates will be for hazard reports only, with no sharing of users' locations.
  - Deployment stays open, so the app works on Vercel or Netlify.
  - Routing keeps the custom accessibility engine rather than OSRM, because accessibility scoring is WheelPath's core feature.
- **Street data:** real OpenStreetMap data saved in `data/osm-snapshot.json`. The network has 464 streets and paths, 946 pathway segments (438 with simulated values) and 40 real places.
- **Server:** the app's own server loads the streets, from the saved file first, then a cache, then the public servers. This removed the Overpass timeouts.
- **Screens:**
  - map
  - search
  - route summary, plus a ratings and barriers page
  - navigation, either a simulated walk or following your GPS, with re-routing if you leave the path by more than 30 m
  - arrival rating
  - reports list
  - hazard details with comments
  - report form
  - preferences, including a choice between the demo position and phone GPS
  - an "About the data" page that says what is real and what is simulated
- **Simulation tuning:** real streets have many more crossings than the sample grid, so the odds of simulated barriers were lowered. The demo start is picked by walking distance, so the route to the school is 428 m and rated accessible, while routes further west run into the simulated tricycle blockage.
- **Testing:** the type check and production build pass. Browser tests at phone sizes (390 px and 360 px) and desktop (1280 px) ran on the real network with no errors.
- **Not yet tested:** live OpenFreeMap tiles and real phone GPS.

---

## 4. Deployment (in progress)

- **Done:** the code is pushed to GitHub.
- **Next:** connect Netlify to the repository (Add new project → Import an existing project → GitHub → wheelpath). The old Netlify site was a drag-and-drop upload, so it does not update from GitHub.
- **Alternative:** Vercel (sign in with GitHub → Add New → Project → wheelpath).
- **After deploying:** make the site public, and test GPS on a phone. Location only works on https pages.

---

## 5. What comes next

1. **Field data:** survey streets around A. Pablo St with the 2024 IRR checklist (width, slope, surface, curb ramps, hazards) and import the results in place of the simulated layer.
2. **Shared hazard reports:** a Node API with PostgreSQL/PostGIS to store reports, and Socket.IO so new reports appear on everyone's map.
3. **Open research questions:**
   - exactly how checklist items map to the 1–5 stars;
   - whether to keep the "shortest path" option;
   - who receives and verifies reports;
   - whether the final platform is a web app or a native app.
4. **Before a public pilot:** review the current terms of OpenFreeMap and the Overpass servers, and use a paid or self-hosted provider if needed.
5. **Accounts and sign-in.**

---

## Key links and files

- Design canvas: https://claude.ai/artifact/B2aPCh9DpJEsVhGXcUY3zD
- Sample-data prototype: https://claude.ai/artifact/VYBoMYTtuwF1R2q7NNvCpj
- Code: `Documents/GitHub/wheelpath`. `README.md` there covers setup, deployment and the code layout.
- Notes in the WheelPath project: `claude/wheelpath-prototype-notes.md` and `claude/wheelpath-live-map-notes.md`
