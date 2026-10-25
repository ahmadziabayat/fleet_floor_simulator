# Fleet Floor Simulator

A small full-stack warehouse fleet simulator. The simulation engine is framework-independent JavaScript; the API and scenario runner both call the same engine. The browser UI is Angular 21, the API is Node.js/Express, and SQLite stores the current floor and its event history.

## Scope

Implemented the required floor, robot queues, simultaneous tick resolution, SQLite persistence, change history, and scenario runner. The two depth modules selected are:

- **A: Pathfinding.** `GOTO X,Y` uses breadth-first search on each tick, chooses first steps in NORTH, EAST, SOUTH, WEST order, waits through temporary no-path periods, and logs `UNREACHABLE` after three consecutive ticks without a route.
- **B: Battery and chargers.** Robots begin at 100, successful moves cost one, chargers restore 10 at end of tick up to 100, and a zero-battery move is blocked with `NO_BATTERY`.

These modules extend the same engine path used by manual UI commands and scenario input. Timeline/fork (C) and multi-user realtime synchronization (D) are not implemented.

## Requirements

- Node.js 20.19+ or 22.12+ (Angular 21 runtime support)
- npm

## Run

```powershell
npm install
npm run dev
```

Open `http://localhost:4200`. The Angular dev server proxies `/api` to the Node API on port 3001. The API creates `data/fleet.sqlite` automatically and restores its saved floor on restart. Set `PORT` to change the API port.

For a production-style local run:

```powershell
npm run build
npm start
```

Express serves the Angular build and API from the same origin on port 3001.

## Scenario runner

```powershell
npm run scenario -- scenarios/chain.txt
```

Supported instructions are case-insensitive: `FLOOR W,H`, `OBSTACLE X,Y`, `CHARGER X,Y`, `PLACE Rn X,Y,FACING`, `QUEUE Rn MOVE|LEFT|RIGHT|GOTO X,Y ...`, `TICK [N]`, `REPORT`, and `REPORT BATTERY`. The CLI uses the required 5x5 default; the web API starts with a 10x8 floor. Blank lines and `#` comments are ignored. Invalid instructions are skipped.

The five required movement examples live in `scenarios/`. `test/scenario.test.js` asserts their outputs, and also covers malformed input and battery reporting.

## Tests

```powershell
npm test
npm run build
```

The tests cover chains, numeric ID contest arbitration (including R2 versus R10), following blocked by a loser, head-on swaps, three-or-more robot cycles, boundaries, obstacles, GOTO path recovery and timeout, charging, all five CLI examples, and API persistence across a server restart.

## Design notes and cuts

- [DECISIONS.md](DECISIONS.md) records behavior choices and spec ambiguities.
- [AI_USAGE.md](AI_USAGE.md) records AI-assisted work and corrections made during verification.
- The API owns one floor per process and one server-side play timer. There is no websocket broadcast or multi-process locking; clients only refresh while the simulation is playing.
- History is append-only in SQLite and has no retention policy. The current world snapshot is stored as JSON in SQLite and updated transactionally with the history table.
- `npm audit --omit=dev` reports no production vulnerabilities. Full `npm audit` currently reports moderate/high advisories through Angular 21's development build tool and its `undici` dependency; npm's forced remediation downgrades the build tool to Angular 20, so that breaking change was not applied.
- No timeline snapshots/replay/fork, authentication, multi-floor support, browser end-to-end test, or cross-process coordination is included.
- The battery example in the brief says 97 for three queued moves on a 3x1 floor. Starting at x=0, only two moves succeed; the third hits the wall. Following the written rule that blocked moves cost nothing, the runner reports 98. This discrepancy is documented in DECISIONS.md.