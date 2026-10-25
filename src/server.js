/** Express API: validates world actions, runs ticks, and serves the Angular build. */
import express from "express";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  advanceTick,
  createWorld,
  inBounds,
  placeNextRobot,
  queueCommands,
  robotAt,
  serializeWorld,
  setCharger,
  setObstacle,
} from "./engine.js";
import { WorldStore } from "./store.js";

/** Sends a consistent JSON error response for a rejected API action. */
function apiError(response, status, message) {
  return response.status(status).json({ error: message });
}

/** Builds an API instance and its single floor/tick loop for the supplied database. */
export function createApplication(databasePath = join(process.cwd(), "data", "fleet.sqlite")) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const store = new WorldStore(databasePath);
  let world = store.load();
  store.save(world);
  let timer = null;
  let intervalMs = 500;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  /** Adds runtime play-loop metadata to the serializable world snapshot. */
  const state = () => ({ ...serializeWorld(world), playing: timer !== null, intervalMs });
  /** Saves the current world and sends its state plus any action-specific data. */
  const saveAndRespond = (response, extra = {}) => {
    store.save(world);
    response.json({ ...state(), ...extra });
  };

  /** Returns the current floor, robot queues, play status, and event history. */
  app.get("/api/state", (_request, response) => response.json(state()));

  /** Replaces the floor dimensions while retaining and extending its audit history. */
  app.post("/api/floor", (request, response) => {
    try {
      const replacement = createWorld(Number(request.body.width), Number(request.body.height));
      replacement.events = world.events;
      replacement.events.push({ tick: 0, type: "FLOOR_RESET", width: replacement.width, height: replacement.height });
      world = replacement;
      saveAndRespond(response);
    } catch (error) {
      apiError(response, 400, error.message);
    }
  });

  /** Places a north-facing robot at the next free ID. */
  app.post("/api/robots", (request, response) => {
    const { x, y } = request.body;
    const id = placeNextRobot(world, Number(x), Number(y));
    if (!id) return apiError(response, 409, "Cell is outside the floor, blocked, or occupied.");
    return saveAndRespond(response, { createdRobotId: id });
  });

  /** Adds or removes an obstacle after checking bounds and robot occupancy. */
  app.post("/api/obstacles", (request, response) => {
    const { x, y, enabled } = request.body;
    const cellX = Number(x);
    const cellY = Number(y);
    if (!inBounds(world, cellX, cellY)) return apiError(response, 400, "Cell is outside the floor.");
    if (enabled && robotAt(world, cellX, cellY)) return apiError(response, 409, "An obstacle cannot cover a robot.");
    const changed = setObstacle(world, cellX, cellY, Boolean(enabled));
    if (!changed && Boolean(enabled) !== world.obstacles.has(`${cellX},${cellY}`)) return apiError(response, 409, "Obstacle could not be changed.");
    return saveAndRespond(response);
  });

  /** Adds or removes a charger at a valid floor coordinate. */
  app.post("/api/chargers", (request, response) => {
    const changed = setCharger(world, Number(request.body.x), Number(request.body.y), Boolean(request.body.enabled));
    if (!changed && !inBounds(world, Number(request.body.x), Number(request.body.y))) return apiError(response, 400, "Cell is outside the floor.");
    return saveAndRespond(response);
  });

  /** Validates and appends one or more commands to a robot queue. */
  app.post("/api/queue", (request, response) => {
    const { robotId, commands } = request.body;
    if (!Array.isArray(commands) || !queueCommands(world, robotId, commands)) {
      return apiError(response, 409, "Unknown robot or invalid command queue.");
    }
    return saveAndRespond(response);
  });

  /** Advances one simultaneous tick and returns its per-robot results. */
  app.post("/api/tick", (_request, response) => {
    const results = advanceTick(world);
    saveAndRespond(response, { results });
  });

  /** Starts or stops the one server-owned automatic tick interval. */
  app.post("/api/play", (request, response) => {
    const playing = Boolean(request.body.playing);
    if (playing && timer === null) {
      intervalMs = Math.min(3000, Math.max(150, Number(request.body.intervalMs) || 500));
      // Advance and persist a full world tick at each interval.
      timer = setInterval(() => {
        advanceTick(world);
        store.save(world);
      }, intervalMs);
    } else if (!playing && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    return saveAndRespond(response);
  });

  const distPath = resolve("dist", "fleet-floor", "browser");
  if (existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*path", (_request, response) => response.sendFile(join(distPath, "index.html")));
  }

  return {
    app,
    /** Stops background work and closes the store for tests and shutdown. */
    close() {
      if (timer !== null) clearInterval(timer);
      store.close();
    },
  };
}

/** Starts the production API on PORT or the default port 3001. */
async function main() {
  const port = Number(process.env.PORT) || 3001;
  const { app } = createApplication();
  app.listen(port, () => console.log(`Fleet API listening on http://localhost:${port}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();