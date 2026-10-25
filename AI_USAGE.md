# AI Usage Log

GitHub Copilot was used during this implementation to draft the engine, scenario runner, API, Angular operator UI, tests, and documentation from the supplied take-home brief. The code was checked against the required CLI examples, focused engine tests, an API restart test, and an Angular production build.

## Accepted

- A pure engine module shared by the HTTP API and CLI, with the UI kept separate from simulation rules.
- A dependency-graph approach to simultaneous movement, with explicit handling for contests, following, swaps, and larger cycles.
- Pathfinding and battery/charger modules as the two depth choices.
- A standalone Angular frontend using the same API contract and a SQLite-backed Node service.

## Corrected during verification

- An early boundary test expected a robot at (0,0), facing north, to hit a wall; that move is legal. The failing test exposed the mistaken setup, which was changed to point south for the boundary assertion.
- The first GOTO implementation accumulated no-path ticks across a period when a route had become available. A regression test now verifies the requirement's "three ticks in a row" behavior, and the counter resets as soon as a route is found.
- The initial Angular icon package release required Angular 22, whose Node engine range exceeded this workspace's Node 22.19. Package engine and peer metadata were checked, and Angular 21 with the compatible icon package line was selected. A normal `npm install` was verified after the lockfile was generated.
- The first npm install hit an npm 10 Arborist error while resolving Angular's optional peers. Installation succeeded with legacy peer resolution, then a standard `npm install` succeeded from the resulting lockfile. Full audit still reports two Angular build-tool/undici advisories; production dependencies audit clean, and npm's suggested forced fix would downgrade Angular to 20, so it was not applied.
- The supplied battery output 97 conflicts with the written movement-cost rule. The implementation follows the written rule and tests the resulting 98.

## Rejected or left out

- Timeline/fork and realtime multi-user synchronization were not attempted; they would dilute the core and selected modules within the time box.
- Kept the engine shared rather than duplicating simulation rules in the CLI and API, so those entry points cannot drift independently.