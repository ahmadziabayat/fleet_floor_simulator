# Decisions and Assumptions

## Scope

- Implemented the required simulation core, CLI, API, persistence, and operator UI first.
- Chose pathfinding (A) and battery/chargers (B) because both exercise the shared tick engine and can be tested through deterministic scenarios.
- Did not implement timeline/fork (C) or multi-user realtime (D). The current API is one floor in one Node process; the server owns a single interval timer for that floor.

## Floor and robots

- Dimensions must be integer values from 1 through 20. The API/UI defaults to 10x8; the scenario runner defaults to 5x5 as specified.
- Coordinates use the brief's south-west origin. The UI renders higher y rows first so the origin appears at bottom-left.
- UI-created robot IDs use the lowest positive unused number. Scenario `PLACE` accepts positive `Rn` IDs; re-placing an existing ID changes its coordinates and facing while preserving its queue and battery.
- Obstacle placement on a robot is rejected. A charger may share an obstacle cell because the brief says any cell can be a charger; robots still cannot enter that cell.
- An invalid API action returns an error to the UI. The scenario runner ignores the invalid line and continues.

## Tick resolution

- All commands are read from the queue fronts before positions change. Ordinary commands are removed when issued, including a blocked `MOVE`.
- Walls, obstacles, and zero battery make a candidate ineligible. Remaining candidates are grouped by destination; the lowest numeric robot ID wins each contested destination (so R2 beats R10).
- For an occupied destination, movement depends on whether its occupant is also moving successfully. This permits chains into empty cells and blocks chains behind a failed move.
- The dependency resolver rejects two-robot cycles as head-on swaps and permits cycles of three or more robots.
- Tick results are recorded for every robot, including idle robots. Each result includes an end-of-tick position, facing, and battery snapshot.

## Pathfinding

- `GOTO` is a queue item that remains at the front while navigating. A successful step uses the ordinary simultaneous-move resolver; a contest or blocked follow does not discard the GOTO.
- Breadth-first search is recalculated each tick and treats every other robot's current cell as a wall, even if that robot might move away during that tick.
- Neighbor order is NORTH, EAST, SOUTH, WEST, making the first step deterministic among shortest routes.
- A GOTO with no route waits for three consecutive no-path ticks, then is removed and an `UNREACHABLE` event is recorded. Finding a route resets this counter. A GOTO whose target is the robot's current cell completes on its next tick.
- A GOTO target outside the floor or on an obstacle is considered unreachable. Out-of-range targets are accepted into the queue and dropped by the normal three-tick rule rather than rejected at enqueue time.

## Battery and chargers

- Battery starts at 100. A successful MOVE costs one; a blocked MOVE costs nothing. Turns are free.
- A robot ending any tick on a charger gains 10, including when it did not move, capped at 100.
- A zero-battery MOVE is consumed and recorded as `NO_BATTERY`; a GOTO remains queued because it is not an ordinary one-shot MOVE.
- The prompt's battery example is inconsistent with its written rules: on a 3x1 floor, R1 can move from x=0 to x=1 and x=2, then its third move is blocked by the wall. Two successful moves cost two battery, so `REPORT BATTERY` returns 98, not the example's 97. The written blocked-move rule takes precedence.

## Persistence and API

- SQLite contains a singleton JSON world snapshot plus an append-only history table. A transaction updates the snapshot and any new history events together.
- One floor is persisted per database. A floor reset clears obstacles, chargers, robots, and queues, resets the tick to zero, and appends a reset event while retaining earlier events.
- The play interval is owned by the API process, so browser clients cannot create separate tick loops. This is not distributed coordination: multiple API processes against the same database are unsupported.
- History is intentionally unbounded for this take-home. The snapshot is rewritten on each action; a larger system should use versioned snapshots or replay checkpoints.

## UI and tests

- Robot mode selects a robot or places a new one. Obstacle and charger modes toggle cells. Shift-click with a selected robot queues GOTO to that cell.
- Keyboard arrows queue commands only when focus is not in an input. The UI shows all queues, battery, tick state, and the newest 40 events; the full log remains persisted.
- Tests use Node's built-in test runner. Coverage includes engine rules, CLI output, and an API integration test that closes and reopens the SQLite-backed application. Browser behavior and multi-client conflict handling remain unautomated.