/** Main operator view: loads world state, submits actions, and renders the fleet UI. */
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideArrowLeft,
  lucideArrowRight,
  lucideArrowUp,
  lucideBattery,
  lucideBatteryCharging,
  lucideBot,
  lucideCheck,
  lucideCircle,
  lucideClock3,
  lucideCrosshair,
  lucideGrid2x2,
  lucideHistory,
  lucidePause,
  lucidePlay,
  lucidePlus,
  lucideRadio,
  lucideRotateCcw,
  lucideStepForward,
  lucideTriangleAlert,
  lucideWarehouse,
  lucideX,
} from "@ng-icons/lucide";
import { firstValueFrom } from "rxjs";

type Facing = "NORTH" | "EAST" | "SOUTH" | "WEST";
type QueueItem = string | { type: "GOTO"; x: number; y: number; noPathTicks?: number };
type EditMode = "place" | "obstacle" | "charger";

interface Robot {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  queue: QueueItem[];
  battery: number;
}

interface TickResult {
  robotId: string;
  action: string;
  reason?: string;
}

interface WorldEvent {
  tick: number;
  type: string;
  robotId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  enabled?: boolean;
  result?: TickResult;
  commands?: QueueItem[];
}

interface WorldState {
  width: number;
  height: number;
  obstacles: string[];
  chargers: string[];
  robots: Robot[];
  tick: number;
  events: WorldEvent[];
  playing: boolean;
  intervalMs: number;
  createdRobotId?: string;
}

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [provideIcons({
    lucideArrowLeft,
    lucideArrowRight,
    lucideArrowUp,
    lucideBattery,
    lucideBatteryCharging,
    lucideBot,
    lucideCheck,
    lucideCircle,
    lucideClock3,
    lucideCrosshair,
    lucideGrid2x2,
    lucideHistory,
    lucidePause,
    lucidePlay,
    lucidePlus,
    lucideRadio,
    lucideRotateCcw,
    lucideStepForward,
    lucideTriangleAlert,
    lucideWarehouse,
    lucideX,
  })],
  templateUrl: "./app.component.html",
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private pollHandle: number | null = null;
  world: WorldState | null = null;
  selectedId: string | null = null;
  mode: EditMode = "place";
  error = "";
  speed = 500;
  dimensions = { width: 10, height: 8 };
  goto = { x: null as number | null, y: null as number | null };

  /** Robot roster ordered by numeric ID. */
  get robots(): Robot[] {
    return [...(this.world?.robots ?? [])].sort((a, b) => this.robotNumber(a.id) - this.robotNumber(b.id));
  }

  /** Currently selected robot, if it still exists in the loaded world. */
  get selectedRobot(): Robot | null {
    return this.robots.find((robot) => robot.id === this.selectedId) ?? null;
  }

  /** Obstacle coordinates for fast cell rendering and edit-mode checks. */
  get obstacleSet(): Set<string> {
    return new Set(this.world?.obstacles ?? []);
  }

  /** Charger coordinates for fast cell rendering and edit-mode checks. */
  get chargerSet(): Set<string> {
    return new Set(this.world?.chargers ?? []);
  }

  /** Floor row coordinates in display order, with north at the top. */
  get rows(): number[] {
    return Array.from({ length: this.world?.height ?? 0 }, (_, index) => (this.world?.height ?? 0) - index - 1);
  }

  /** Floor column coordinates from west to east. */
  get columns(): number[] {
    return Array.from({ length: this.world?.width ?? 0 }, (_, index) => index);
  }

  /** Most recent events, ordered newest first for the activity panel. */
  get eventFeed(): WorldEvent[] {
    return [...(this.world?.events ?? [])].slice(-40).reverse();
  }

  /** Total number of commands waiting across the robot fleet. */
  get queuedCount(): number {
    return this.robots.reduce((sum, robot) => sum + robot.queue.length, 0);
  }

  /** Loads initial state when Angular creates the root component. */
  ngOnInit(): void {
    void this.refresh();
  }

  /** Clears pending polling when Angular destroys the root component. */
  ngOnDestroy(): void {
    this.stopPolling();
  }

  @HostListener("window:keydown", ["$event"])
  /** Queues movement commands from arrow keys when an input is not focused. */
  onKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    const commandByKey: Record<string, string> = { ArrowUp: "MOVE", ArrowLeft: "LEFT", ArrowRight: "RIGHT" };
    const command = commandByKey[event.key];
    if (command && this.selectedId) {
      event.preventDefault();
      void this.post("/api/queue", { robotId: this.selectedId, commands: [command] });
    }
  }

  /** Builds a coordinate key shared with the API's obstacle and charger sets. */
  cellKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  /** Looks up the robot occupying a rendered grid cell. */
  robotAt(x: number, y: number): Robot | undefined {
    return this.robots.find((robot) => robot.x === x && robot.y === y);
  }

  /** Converts a robot facing into the CSS rotation used by its direction icon. */
  directionTransform(facing: Facing): string {
    const angles: Record<Facing, number> = { NORTH: 0, EAST: 90, SOUTH: 180, WEST: 270 };
    return `rotate(${angles[facing]}deg)`;
  }

  /** Formats either a basic command or a GOTO item for queue display. */
  commandText(command: QueueItem): string {
    return typeof command === "string" ? command : `GOTO ${command.x},${command.y}`;
  }

  /** Converts structured engine events into short activity-feed messages. */
  eventSummary(event: WorldEvent): string {
    if (event.type === "TICK_RESULT" && event.result) {
      const details = event.result.reason ? ` / ${event.result.reason.replaceAll("_", " ").toLowerCase()}` : "";
      return `${event.result.robotId} ${event.result.action.toLowerCase().replaceAll("_", " ")}${details}`;
    }
    if (event.type === "ROBOT_PLACED") return `${event.robotId} placed at ${event.x},${event.y}`;
    if (event.type === "ROBOT_MOVED") return `${event.robotId} repositioned to ${event.x},${event.y}`;
    if (event.type === "COMMANDS_QUEUED") return `${event.robotId} queued ${(event.commands ?? []).map((command) => this.commandText(command)).join(", ")}`;
    if (event.type === "OBSTACLE") return `Obstacle ${event.enabled ? "added" : "removed"} at ${event.x},${event.y}`;
    if (event.type === "CHARGER") return `Charger ${event.enabled ? "added" : "removed"} at ${event.x},${event.y}`;
    if (event.type === "FLOOR_RESET") return `Floor reset to ${event.width} x ${event.height}`;
    if (event.type === "UNREACHABLE") return `${event.robotId} target unreachable`;
    return event.type.toLowerCase().replaceAll("_", " ");
  }

  /** Selects an icon name for a history event's visual marker. */
  eventIcon(event: WorldEvent): string {
    if (event.type === "TICK_RESULT") return "lucideRadio";
    if (event.type === "OBSTACLE") return "lucideX";
    if (event.type === "COMMANDS_QUEUED") return "lucideStepForward";
    return "lucideCircle";
  }

  /** Identifies blocked tick results for warning styling in the history feed. */
  isBlockedEvent(event: WorldEvent): boolean {
    return event.type === "TICK_RESULT" && event.result?.action === "BLOCKED";
  }

  /** Fetches the latest world state and synchronizes automatic polling. */
  async refresh(): Promise<void> {
    try {
      const data = await firstValueFrom(this.http.get<WorldState>("/api/state"));
      this.world = data;
      if (this.dimensions.width !== data.width || this.dimensions.height !== data.height) {
        this.dimensions = { width: data.width, height: data.height };
      }
      this.speed = data.intervalMs ?? 500;
      this.error = "";
      if (this.selectedId && !data.robots.some((robot) => robot.id === this.selectedId)) this.selectedId = null;
      this.updatePolling();
      this.changeDetector.markForCheck();
    } catch (error) {
      this.error = this.errorMessage(error, "The simulator API is unavailable.");
      this.updatePolling();
      this.changeDetector.markForCheck();
    }
  }

  /** Sends a JSON action to the API and updates the local view from its response. */
  async post(path: string, body: unknown): Promise<WorldState | null> {
    this.error = "";
    try {
      const data = await firstValueFrom(this.http.post<WorldState>(path, body));
      this.world = data;
      this.dimensions = { width: data.width, height: data.height };
      this.updatePolling();
      this.changeDetector.markForCheck();
      return data;
    } catch (error) {
      this.error = this.errorMessage(error, "The action could not be completed.");
      this.changeDetector.markForCheck();
      return null;
    }
  }

  /** Queues one command for the selected robot. */
  queue(command: string | { type: "GOTO"; x: number; y: number }): void {
    const robot = this.selectedRobot;
    if (robot) void this.post("/api/queue", { robotId: robot.id, commands: [command] });
  }

  /** Selects a robot, places one, toggles a cell, or queues GOTO on shift-click. */
  onCellClick(x: number, y: number, event: MouseEvent): void {
    if (!this.world) return;
    const robot = this.robotAt(x, y);
    if (event.shiftKey && this.selectedRobot) {
      this.queue({ type: "GOTO", x, y });
      return;
    }
    if (this.mode === "obstacle") {
      void this.post("/api/obstacles", { x, y, enabled: !this.obstacleSet.has(this.cellKey(x, y)) });
      return;
    }
    if (this.mode === "charger") {
      void this.post("/api/chargers", { x, y, enabled: !this.chargerSet.has(this.cellKey(x, y)) });
      return;
    }
    if (robot) {
      this.selectedId = robot.id;
      return;
    }
    void this.post("/api/robots", { x, y }).then((data) => {
      if (data?.createdRobotId) {
        this.selectedId = data.createdRobotId;
        this.changeDetector.markForCheck();
      }
    });
  }

  /** Queues a GOTO command using the coordinate form. */
  submitGoto(event: Event): void {
    event.preventDefault();
    if (!this.selectedRobot || this.goto.x === null || this.goto.y === null) return;
    this.queue({ type: "GOTO", x: this.goto.x, y: this.goto.y });
    this.goto = { x: null, y: null };
  }

  /** Creates a new floor using the dimensions entered in the configuration form. */
  submitFloor(event: Event): void {
    event.preventDefault();
    void this.post("/api/floor", { width: Number(this.dimensions.width), height: Number(this.dimensions.height) }).then((data) => {
      if (data) {
        this.selectedId = null;
        this.changeDetector.markForCheck();
      }
    });
  }

  /** Requests that the API start or stop its single automatic tick loop. */
  setPlaying(playing: boolean): void {
    void this.post("/api/play", { playing, intervalMs: this.speed });
  }

  /** Hides the current API or validation error. */
  dismissError(): void {
    this.error = "";
  }

  /** Extracts the numeric suffix used to sort robot IDs. */
  private robotNumber(id: string): number {
    return Number(id.slice(1));
  }

  /** Chooses a useful message from an HTTP error or a local fallback. */
  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === "string") return error.error.error;
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  /** Schedules polling only while the server reports that the world is playing. */
  private updatePolling(): void {
    this.stopPolling();
    if (this.world?.playing) this.pollHandle = window.setTimeout(() => void this.refresh(), Math.max(300, Math.min(1000, this.world?.intervalMs ?? 500)));
  }

  /** Cancels a previously scheduled state refresh. */
  private stopPolling(): void {
    if (this.pollHandle !== null) window.clearTimeout(this.pollHandle);
    this.pollHandle = null;
  }
}