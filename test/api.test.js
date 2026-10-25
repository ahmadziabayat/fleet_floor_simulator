/** API integration coverage for persisted state across application restarts. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/server.js";

/** Verifies SQLite restores robot state, queues, tick count, and history. */
test("API persists placements, queues, and tick results across application restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fleet-floor-"));
  const databasePath = join(directory, "fleet.sqlite");
  let service = createApplication(databasePath);
  let server = service.app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  /** Sends a JSON POST request to the test server. */
  const post = (path, body) => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  try {
    assert.equal((await (await post("/api/robots", { x: 0, y: 0 })).json()).createdRobotId, "R1");
    assert.equal((await post("/api/queue", { robotId: "R1", commands: ["MOVE"] })).status, 200);
    assert.equal((await post("/api/tick", {})).status, 200);
    await new Promise((resolve) => server.close(resolve));
    service.close();

    service = createApplication(databasePath);
    server = service.app.listen(0);
    const restored = await (await fetch(`http://127.0.0.1:${server.address().port}/api/state`)).json();
    assert.equal(restored.robots[0].x, 0);
    assert.equal(restored.robots[0].y, 1);
    assert.equal(restored.tick, 1);
    assert.deepEqual(restored.robots[0].queue, []);
    const tickEvent = restored.events.find((event) => event.type === "TICK_RESULT");
    assert.deepEqual(tickEvent.robot, { x: 0, y: 1, facing: "NORTH", battery: 99 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    service.close();
    await rm(directory, { recursive: true, force: true });
  }
});