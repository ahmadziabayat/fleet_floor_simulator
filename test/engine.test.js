/** Regression tests for simultaneous movement and the two implemented depth modules. */
import test from "node:test";
import assert from "node:assert/strict";
import { advanceTick, createWorld, placeRobot, queueCommands, robotReport, setCharger, setObstacle } from "../src/engine.js";

/** Places a fixture robot and fails immediately if the fixture is invalid. */
function robot(world, id, x, y, facing) {
  assert.equal(placeRobot(world, id, x, y, facing), true);
}

/** Covers following into an empty cell and successful cycles with four robots. */
test("a chain advances together and a four-robot cycle rotates", () => {
  const chain = createWorld(5, 5);
  robot(chain, "R1", 0, 0, "EAST");
  robot(chain, "R2", 1, 0, "EAST");
  robot(chain, "R3", 2, 0, "EAST");
  for (const id of ["R1", "R2", "R3"]) queueCommands(chain, id, ["MOVE"]);
  advanceTick(chain);
  assert.equal(robotReport(chain), "R1 1,0,EAST\nR2 2,0,EAST\nR3 3,0,EAST");

  const cycle = createWorld(2, 2);
  robot(cycle, "R1", 0, 0, "NORTH");
  robot(cycle, "R2", 0, 1, "EAST");
  robot(cycle, "R3", 1, 1, "SOUTH");
  robot(cycle, "R4", 1, 0, "WEST");
  for (const id of ["R1", "R2", "R3", "R4"]) queueCommands(cycle, id, ["MOVE"]);
  advanceTick(cycle);
  assert.equal(robotReport(cycle), "R1 0,1,NORTH\nR2 1,1,EAST\nR3 1,0,SOUTH\nR4 0,0,WEST");
});

/** Verifies a losing contender blocks a robot queued behind it. */
test("contested destinations favor numeric ID order and block followers", () => {
  const world = createWorld(5, 3);
  robot(world, "R1", 0, 1, "EAST");
  robot(world, "R2", 2, 1, "WEST");
  robot(world, "R3", 3, 1, "WEST");
  for (const id of ["R1", "R2", "R3"]) queueCommands(world, id, ["MOVE"]);
  const results = advanceTick(world);
  assert.equal(robotReport(world), "R1 1,1,EAST\nR2 2,1,WEST\nR3 3,1,WEST");
  assert.equal(results.find((result) => result.robotId === "R2").reason, "CONTESTED_CELL");
  assert.equal(results.find((result) => result.robotId === "R3").reason, "FOLLOWING_BLOCKED");
});

/** Ensures R2 wins a contest against R10 by numeric rather than lexical order. */
test("contested destinations compare numeric ID values, not ID text", () => {
  const world = createWorld(5, 3);
  robot(world, "R10", 0, 1, "EAST");
  robot(world, "R2", 2, 1, "WEST");
  queueCommands(world, "R10", ["MOVE"]);
  queueCommands(world, "R2", ["MOVE"]);
  const results = advanceTick(world);
  assert.equal(robotReport(world), "R2 1,1,WEST\nR10 0,1,EAST");
  assert.equal(results.find((result) => result.robotId === "R2").action, "MOVED");
  assert.equal(results.find((result) => result.robotId === "R10").reason, "CONTESTED_CELL");
});

/** Covers two-way swaps and movement blocked by edges or obstacles. */
test("a head-on swap, boundaries, and obstacles block movement", () => {
  const world = createWorld(2, 2);
  robot(world, "R1", 0, 0, "EAST");
  robot(world, "R2", 1, 0, "WEST");
  queueCommands(world, "R1", ["MOVE"]);
  queueCommands(world, "R2", ["MOVE"]);
  assert.deepEqual(advanceTick(world).map((result) => result.reason), ["HEAD_ON_SWAP", "HEAD_ON_SWAP"]);
  queueCommands(world, "R1", ["RIGHT", "MOVE"]);
  advanceTick(world);
  assert.equal(advanceTick(world)[0].reason, "WALL");
  assert.equal(setObstacle(world, 1, 1), true);
  queueCommands(world, "R2", ["RIGHT", "MOVE"]);
  advanceTick(world);
  assert.equal(advanceTick(world)[1].reason, "OBSTACLE");
});

/** Covers GOTO routing/recovery/timeout plus charger capacity behavior. */
test("GOTO takes shortest steps, waits three unreachable ticks, and battery recharges", () => {
  const world = createWorld(4, 2);
  robot(world, "R1", 0, 0, "SOUTH");
  queueCommands(world, "R1", [{ type: "GOTO", x: 3, y: 0 }]);
  advanceTick(world);
  assert.equal(world.robots.get("R1").facing, "EAST");
  advanceTick(world);
  advanceTick(world);
  assert.equal(robotReport(world), "R1 3,0,EAST");
  assert.equal(world.robots.get("R1").queue.length, 0);
  setObstacle(world, 0, 1);
  setObstacle(world, 1, 0);
  queueCommands(world, "R1", [{ type: "GOTO", x: 0, y: 0 }]);
  const unreachable = [advanceTick(world), advanceTick(world), advanceTick(world)];
  assert.equal(unreachable[2][0].action, "UNREACHABLE");
  assert.ok(world.events.some((event) => event.type === "UNREACHABLE" && event.robotId === "R1"));

  const intermittent = createWorld(3, 1);
  robot(intermittent, "R1", 0, 0, "EAST");
  setObstacle(intermittent, 1, 0);
  queueCommands(intermittent, "R1", [{ type: "GOTO", x: 2, y: 0 }]);
  assert.equal(advanceTick(intermittent)[0].action, "WAITING");
  setObstacle(intermittent, 1, 0, false);
  assert.equal(advanceTick(intermittent)[0].action, "MOVED");
  setObstacle(intermittent, 2, 0);
  assert.equal(advanceTick(intermittent)[0].action, "WAITING");
  assert.equal(advanceTick(intermittent)[0].action, "WAITING");
  assert.equal(advanceTick(intermittent)[0].action, "UNREACHABLE");

  const chargerWorld = createWorld(3, 1);
  robot(chargerWorld, "R1", 0, 0, "EAST");
  chargerWorld.robots.get("R1").battery = 98;
  setCharger(chargerWorld, 1, 0);
  queueCommands(chargerWorld, "R1", ["MOVE"]);
  advanceTick(chargerWorld);
  assert.equal(chargerWorld.robots.get("R1").battery, 100);
});