/** Verifies CLI scenario output against the required examples and invalid-input rules. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runScenario } from "../src/scenario.js";

const examples = [
  ["chain", "R1 1,0,EAST\nR2 2,0,EAST\nR3 3,0,EAST"],
  ["head-on-swap", "R1 0,0,EAST\nR2 1,0,WEST"],
  ["contested-cell", "R1 1,1,EAST\nR2 2,1,WEST\nR3 3,1,WEST"],
  ["rotation", "R1 0,1,NORTH\nR2 1,1,EAST\nR3 1,0,SOUTH\nR4 0,0,WEST"],
  ["queue-lengths", "R1 2,2,SOUTH\nR2 1,1,EAST\nR1 2,2,SOUTH\nR2 3,1,EAST"],
];

// Each fixture asserts the exact report text produced by the shared engine.
for (const [name, expected] of examples) {
  test(`scenario example: ${name}`, async () => {
    const input = await readFile(new URL(`../scenarios/${name}.txt`, import.meta.url), "utf8");
    assert.equal(runScenario(input), expected);
  });
}

/** Confirms malformed instructions do not stop the scenario parser. */
test("malformed commands are ignored and later reports still run", () => {
  const output = runScenario(`FLOOR 2,2\nPLACE R1 0,0,EAST\nPLACE R2 9,9,NORTH\nQUEUE R9 MOVE\nNOT A COMMAND\nREPORT`);
  assert.equal(output, "R1 0,0,EAST");
});

/** Locks in the written rule that blocked movement consumes no battery. */
test("battery reporting follows successful-move charging semantics", () => {
  const output = runScenario(`FLOOR 3,1\nPLACE R1 0,0,EAST\nQUEUE R1 MOVE MOVE MOVE\nTICK 3\nREPORT BATTERY`);
  assert.equal(output, "R1 98");
});