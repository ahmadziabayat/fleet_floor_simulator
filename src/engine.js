/** Pure simulation state and rules shared by the API and scenario runner. */
const DIRECTIONS = ["NORTH", "EAST", "SOUTH", "WEST"];
const DELTAS = {
  NORTH: [0, 1],
  EAST: [1, 0],
  SOUTH: [0, -1],
  WEST: [-1, 0],
};

/** Converts grid coordinates to the key used by obstacle and charger sets. */
const cellKey = (x, y) => `${x},${y}`;
/** Returns the numeric part of an ID for correct robot ordering. */
const idNumber = (id) => Number(id.slice(1));
/** Checks whether two coordinate-bearing objects refer to the same cell. */
const samePosition = (a, b) => a.x === b.x && a.y === b.y;

/** Creates an empty world after validating the floor dimensions. */
export function createWorld(width = 5, height = 5) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20 || height > 20) {
    throw new RangeError("Floor dimensions must be integers from 1 to 20");
  }
  return {
    width,
    height,
    obstacles: new Set(),
    chargers: new Set(),
    robots: new Map(),
    tick: 0,
    events: [],
  };
}

/** Returns whether an integer coordinate is inside the floor. */
export function inBounds(world, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.width && y < world.height;
}

/** Finds the robot occupying a coordinate, if any. */
export function robotAt(world, x, y) {
  return [...world.robots.values()].find((robot) => robot.x === x && robot.y === y);
}

/** Appends a timestamped event to the world's history. */
function record(world, type, details = {}) {
  const event = { tick: world.tick, type, ...details };
  world.events.push(event);
  return event;
}

/** Adds or removes an obstacle, rejecting cells outside the floor or under robots. */
export function setObstacle(world, x, y, enabled = true) {
  if (!inBounds(world, x, y) || robotAt(world, x, y)) return false;
  const key = cellKey(x, y);
  const changed = enabled ? !world.obstacles.has(key) : world.obstacles.has(key);
  if (!changed) return false;
  if (enabled) world.obstacles.add(key);
  else world.obstacles.delete(key);
  record(world, "OBSTACLE", { x, y, enabled });
  return true;
}

/** Adds or removes a charger and records the change. */
export function setCharger(world, x, y, enabled = true) {
  if (!inBounds(world, x, y)) return false;
  const key = cellKey(x, y);
  const changed = enabled ? !world.chargers.has(key) : world.chargers.has(key);
  if (!changed) return false;
  if (enabled) world.chargers.add(key);
  else world.chargers.delete(key);
  record(world, "CHARGER", { x, y, enabled });
  return true;
}

/** Places or repositions a robot when its destination and facing are valid. */
export function placeRobot(world, id, x, y, facing = "NORTH") {
  const normalizedId = String(id).toUpperCase();
  if (!/^R\d+$/.test(normalizedId) || !inBounds(world, x, y) || !DIRECTIONS.includes(facing)) return false;
  if (world.obstacles.has(cellKey(x, y))) return false;
  const occupant = robotAt(world, x, y);
  if (occupant && occupant.id !== normalizedId) return false;
  const existing = world.robots.get(normalizedId);
  const robot = existing
    ? { ...existing, x, y, facing }
    : { id: normalizedId, x, y, facing, queue: [], battery: 100, noPathTicks: 0 };
  world.robots.set(normalizedId, robot);
  record(world, existing ? "ROBOT_MOVED" : "ROBOT_PLACED", { robotId: normalizedId, x, y, facing });
  return true;
}

/** Places a north-facing robot using the lowest available positive ID. */
export function placeNextRobot(world, x, y) {
  let number = 1;
  while (world.robots.has(`R${number}`)) number += 1;
  const id = `R${number}`;
  return placeRobot(world, id, x, y) ? id : null;
}

/** Validates and appends a batch of commands to one robot's queue. */
export function queueCommands(world, id, commands) {
  const robot = world.robots.get(String(id).toUpperCase());
  if (!robot) return false;
  const normalized = [];
  for (const command of commands) {
    if (typeof command === "string") {
      const value = command.toUpperCase();
      if (!["MOVE", "LEFT", "RIGHT"].includes(value)) return false;
      normalized.push(value);
    } else if (command?.type === "GOTO" && Number.isInteger(command.x) && Number.isInteger(command.y)) {
      normalized.push({ type: "GOTO", x: command.x, y: command.y, noPathTicks: 0 });
    } else {
      return false;
    }
  }
  if (!normalized.length) return false;
  robot.queue.push(...normalized);
  record(world, "COMMANDS_QUEUED", { robotId: robot.id, commands: structuredClone(normalized) });
  return true;
}

/** Finds the first step of a shortest route, respecting direction tie order and blockers. */
function shortestPathStep(world, robot, target) {
  if (!inBounds(world, target.x, target.y) || world.obstacles.has(cellKey(target.x, target.y))) return null;
  const occupied = new Set([...world.robots.values()]
    .filter((other) => other.id !== robot.id)
    .map((other) => cellKey(other.x, other.y)));
  const start = { x: robot.x, y: robot.y };
  const queue = [start];
  const previous = new Map([[cellKey(start.x, start.y), null]]);
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (samePosition(current, target)) break;
    for (const facing of DIRECTIONS) {
      const [dx, dy] = DELTAS[facing];
      const next = { x: current.x + dx, y: current.y + dy };
      const key = cellKey(next.x, next.y);
      if (!inBounds(world, next.x, next.y) || world.obstacles.has(key) || occupied.has(key) || previous.has(key)) continue;
      previous.set(key, { key: cellKey(current.x, current.y), facing });
      queue.push(next);
    }
  }

  const targetKey = cellKey(target.x, target.y);
  if (!previous.has(targetKey)) return null;
  if (samePosition(start, target)) return { arrived: true };
  let key = targetKey;
  let link = previous.get(key);
  while (link?.key !== cellKey(start.x, start.y)) {
    key = link.key;
    link = previous.get(key);
  }
  return { facing: link.facing, x: Number(key.split(",")[0]), y: Number(key.split(",")[1]) };
}

/** Rotates a facing by the requested number of quarter-turns. */
function rotate(facing, amount) {
  return DIRECTIONS[(DIRECTIONS.indexOf(facing) + amount + 4) % 4];
}

/** Resolves candidate moves together, including contests, following, swaps, and cycles. */
function resolveMoves(world, moveCandidates) {
  const byDestination = new Map();
  for (const candidate of moveCandidates.values()) {
    const key = cellKey(candidate.x, candidate.y);
    byDestination.set(key, [...(byDestination.get(key) ?? []), candidate]);
  }

  const outcomes = new Map();
  for (const candidates of byDestination.values()) {
    candidates.sort((a, b) => idNumber(a.robot.id) - idNumber(b.robot.id));
    for (const loser of candidates.slice(1)) outcomes.set(loser.robot.id, { moved: false, reason: "CONTESTED_CELL" });
  }

  /** Recursively determines whether a robot's destination can be vacated this tick. */
  const visit = (id, path = []) => {
    if (outcomes.has(id)) return outcomes.get(id).moved;
    const cycleStart = path.indexOf(id);
    if (cycleStart !== -1) {
      const cycle = path.slice(cycleStart);
      const allowed = cycle.length >= 3;
      for (const cycleId of cycle) outcomes.set(cycleId, { moved: allowed, reason: allowed ? null : "HEAD_ON_SWAP" });
      return allowed;
    }
    const candidate = moveCandidates.get(id);
    if (!candidate) return false;
    const occupant = robotAt(world, candidate.x, candidate.y);
    if (!occupant) {
      outcomes.set(id, { moved: true, reason: null });
      return true;
    }
    if (occupant.id === id) {
      outcomes.set(id, { moved: false, reason: "HEAD_ON_SWAP" });
      return false;
    }
    const nextPath = [...path, id];
    const occupantMoves = moveCandidates.has(occupant.id) && outcomes.get(occupant.id)?.reason !== "CONTESTED_CELL";
    const canFollow = occupantMoves && visit(occupant.id, nextPath);
    if (!outcomes.has(id)) outcomes.set(id, { moved: canFollow, reason: canFollow ? null : "FOLLOWING_BLOCKED" });
    return outcomes.get(id).moved;
  };

  for (const id of moveCandidates.keys()) visit(id);
  return outcomes;
}

/** Plans one GOTO tick, retaining the command while navigating or waiting. */
function prepareGoto(world, robot, command, results, candidates) {
  if (samePosition(robot, command)) {
    robot.queue.shift();
    robot.noPathTicks = 0;
    results.set(robot.id, { robotId: robot.id, action: "GOTO_COMPLETE" });
    return;
  }
  const step = shortestPathStep(world, robot, command);
  if (!step) {
    command.noPathTicks += 1;
    robot.noPathTicks = command.noPathTicks;
    if (command.noPathTicks >= 3) {
      robot.queue.shift();
      robot.noPathTicks = 0;
      results.set(robot.id, { robotId: robot.id, action: "UNREACHABLE", target: { x: command.x, y: command.y } });
    } else {
      results.set(robot.id, { robotId: robot.id, action: "WAITING", reason: "NO_PATH" });
    }
    return;
  }
  command.noPathTicks = 0;
  robot.noPathTicks = 0;
  robot.facing = step.facing;
  if (robot.battery === 0) {
    results.set(robot.id, { robotId: robot.id, action: "BLOCKED", reason: "NO_BATTERY" });
    return;
  }
  const [dx, dy] = DELTAS[robot.facing];
  candidates.set(robot.id, { robot, x: robot.x + dx, y: robot.y + dy, goto: true });
}

/** Consumes or interprets one queued command and prepares any move candidate. */
function prepareCommand(world, robot, results, candidates) {
  const command = robot.queue[0];
  if (!command) {
    results.set(robot.id, { robotId: robot.id, action: "IDLE" });
    return;
  }
  if (typeof command === "object") {
    prepareGoto(world, robot, command, results, candidates);
    return;
  }
  robot.queue.shift();
  if (command === "LEFT" || command === "RIGHT") {
    robot.facing = rotate(robot.facing, command === "LEFT" ? -1 : 1);
    results.set(robot.id, { robotId: robot.id, action: "TURNED", direction: command, facing: robot.facing });
    return;
  }
  const [dx, dy] = DELTAS[robot.facing];
  const x = robot.x + dx;
  const y = robot.y + dy;
  if (!inBounds(world, x, y)) results.set(robot.id, { robotId: robot.id, action: "BLOCKED", reason: "WALL" });
  else if (world.obstacles.has(cellKey(x, y))) results.set(robot.id, { robotId: robot.id, action: "BLOCKED", reason: "OBSTACLE" });
  else if (robot.battery === 0) results.set(robot.id, { robotId: robot.id, action: "BLOCKED", reason: "NO_BATTERY" });
  else candidates.set(robot.id, { robot, x, y, goto: false });
}

/** Removes candidates that would enter a wall or obstacle and records their block reason. */
function legalCandidates(world, candidates, results) {
  const legal = new Map();
  for (const [id, candidate] of candidates) {
    if (!inBounds(world, candidate.x, candidate.y)) {
      results.set(id, { robotId: id, action: "BLOCKED", reason: "WALL" });
    } else if (world.obstacles.has(cellKey(candidate.x, candidate.y))) {
      results.set(id, { robotId: id, action: "BLOCKED", reason: "OBSTACLE" });
    } else {
      legal.set(id, candidate);
    }
  }
  return legal;
}

/** Applies resolved movement outcomes and completes GOTO commands on arrival. */
function applyMoveOutcomes(world, candidates, outcomes, results) {
  for (const [id, candidate] of candidates) {
    const outcome = outcomes.get(id) ?? { moved: false, reason: "OCCUPIED" };
    if (!outcome.moved) {
      results.set(id, { robotId: id, action: "BLOCKED", reason: outcome.reason });
      continue;
    }
    candidate.robot.x = candidate.x;
    candidate.robot.y = candidate.y;
    candidate.robot.battery = Math.max(0, candidate.robot.battery - 1);
    results.set(id, { robotId: id, action: "MOVED", x: candidate.x, y: candidate.y });
    if (candidate.goto && samePosition(candidate.robot, candidate.robot.queue[0])) {
      candidate.robot.queue.shift();
      candidate.robot.noPathTicks = 0;
    }
  }
}

/** Recharges robots, records each tick result, and returns results in numeric ID order. */
function finishTick(world, results) {
  for (const robot of world.robots.values()) {
    if (world.chargers.has(cellKey(robot.x, robot.y))) robot.battery = Math.min(100, robot.battery + 10);
    const result = results.get(robot.id) ?? { robotId: robot.id, action: "IDLE" };
    record(world, "TICK_RESULT", {
      result,
      robot: { x: robot.x, y: robot.y, facing: robot.facing, battery: robot.battery },
    });
    if (result.action === "UNREACHABLE") record(world, "UNREACHABLE", { robotId: robot.id, target: result.target });
  }
  return [...results.values()].sort((a, b) => idNumber(a.robotId) - idNumber(b.robotId));
}

/** Advances all robots by one simultaneous tick using the shared movement resolver. */
export function advanceTick(world) {
  world.tick += 1;
  const results = new Map();
  const candidates = new Map();
  for (const robot of world.robots.values()) prepareCommand(world, robot, results, candidates);
  const legal = legalCandidates(world, candidates, results);
  applyMoveOutcomes(world, legal, resolveMoves(world, legal), results);
  return finishTick(world, results);
}

/** Converts Maps and Sets into a JSON-safe world snapshot. */
export function serializeWorld(world) {
  return {
    width: world.width,
    height: world.height,
    obstacles: [...world.obstacles],
    chargers: [...world.chargers],
    robots: [...world.robots.values()].map((robot) => structuredClone(robot)),
    tick: world.tick,
    events: structuredClone(world.events),
  };
}

/** Rebuilds the engine's Maps and Sets from a saved world snapshot. */
export function deserializeWorld(snapshot) {
  const world = createWorld(snapshot.width, snapshot.height);
  world.obstacles = new Set(snapshot.obstacles ?? []);
  world.chargers = new Set(snapshot.chargers ?? []);
  world.robots = new Map((snapshot.robots ?? []).map((robot) => [robot.id, structuredClone(robot)]));
  world.tick = snapshot.tick ?? 0;
  world.events = structuredClone(snapshot.events ?? []);
  return world;
}

/** Formats robot positions and facings as a report sorted by numeric ID. */
export function robotReport(world) {
  const robots = [...world.robots.values()].sort((a, b) => idNumber(a.id) - idNumber(b.id));
  return robots.length ? robots.map((robot) => `${robot.id} ${robot.x},${robot.y},${robot.facing}`).join("\n") : "EMPTY";
}

export const directionNames = DIRECTIONS;