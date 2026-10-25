/** Parses scenario text and executes every operation through the shared engine. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  advanceTick,
  createWorld,
  placeRobot,
  queueCommands,
  robotReport,
  setCharger,
  setObstacle,
} from "./engine.js";

/** Parses an X,Y token into integer coordinates. */
function coordinates(token) {
  const match = /^(-?\d+),(-?\d+)$/.exec(token ?? "");
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Creates a replacement floor when a valid FLOOR command is supplied. */
function floorCommand(_world, args) {
  if (args.length !== 1) return null;
  const dimensions = coordinates(args[0]);
  if (!dimensions) return null;
  try {
    return createWorld(...dimensions);
  } catch {
    return null;
  }
}

/** Applies a parsed cell operation such as OBSTACLE or CHARGER. */
function cellCommand(world, args, operation) {
  const position = coordinates(args[0]);
  if (position) operation(world, ...position);
  return world;
}

/** Places or relocates the robot described by a PLACE command. */
function placeCommand(world, args) {
  if (args.length !== 2) return world;
  const match = /^(R\d+)$/i.exec(args[0]);
  const [x, y, facing] = (args[1] ?? "").split(",");
  if (match && /^-?\d+$/.test(x ?? "") && /^-?\d+$/.test(y ?? "")) {
    placeRobot(world, match[1], Number(x), Number(y), (facing ?? "").toUpperCase());
  }
  return world;
}

/** Converts queue tokens into engine commands, including GOTO targets. */
function parseQueue(args) {
  const queued = [];
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index].toUpperCase();
    if (value !== "GOTO") {
      queued.push(value);
      continue;
    }
    const target = coordinates(args[index + 1]);
    if (!target) return null;
    queued.push({ type: "GOTO", x: target[0], y: target[1] });
    index += 1;
  }
  return queued;
}

/** Validates and appends the commands from one QUEUE instruction. */
function queueCommand(world, args) {
  if (args.length < 2) return world;
  const queued = parseQueue(args);
  if (queued) queueCommands(world, args[0].toUpperCase(), queued);
  return world;
}

/** Advances the shared engine by the requested number of ticks. */
function tickCommand(world, args) {
  if (args.length > 1) return world;
  const count = args.length ? Number(args[0]) : 1;
  if (Number.isInteger(count) && count >= 0 && count <= 100000) {
    for (let index = 0; index < count; index += 1) advanceTick(world);
  }
  return world;
}

/** Adds a position or battery report to the runner's output list. */
function reportCommand(world, args, reports) {
  if (!args.length) reports.push(robotReport(world));
  else if (args.length === 1 && args[0].toUpperCase() === "BATTERY") {
    const robots = [...world.robots.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    reports.push(robots.length ? robots.map((robot) => `${robot.id} ${robot.battery}`).join("\n") : "EMPTY");
  }
  return world;
}

/** Executes a complete scenario and returns the output for its REPORT lines. */
export function runScenario(text) {
  let world = createWorld(5, 5);
  const reports = [];
  /** Maps scenario keywords to their command-specific handlers. */
  const handlers = new Map([
    ["FLOOR", floorCommand],
    // Delegate cell changes to the same operations used by the API.
    ["OBSTACLE", (current, args) => cellCommand(current, args, setObstacle)],
    ["CHARGER", (current, args) => cellCommand(current, args, setCharger)],
    ["PLACE", placeCommand],
    ["QUEUE", queueCommand],
    ["TICK", tickCommand],
    ["REPORT", (current, args) => reportCommand(current, args, reports)],
  ]);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [rawCommand, ...args] = line.split(/\s+/);
    world = handlers.get(rawCommand.toUpperCase())?.(world, args) ?? world;
  }
  return reports.join("\n");
}

/** Reads the requested scenario file and prints its reports to stdout. */
async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npm run scenario -- path/to/scenario.txt");
    process.exitCode = 2;
    return;
  }
  try {
    const output = runScenario(await readFile(path, "utf8"));
    if (output) process.stdout.write(`${output}\n`);
  } catch (error) {
    console.error(`Could not read scenario: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();