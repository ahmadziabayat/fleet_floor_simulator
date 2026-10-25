/** Persists the current world snapshot and append-only event history in SQLite. */
import Database from "better-sqlite3";
import { deserializeWorld, createWorld, serializeWorld } from "./engine.js";

export class WorldStore {
  /** Opens the database and prepares atomic world/history persistence statements. */
  constructor(path) {
    this.database = new Database(path);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS world_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tick INTEGER NOT NULL,
        event TEXT NOT NULL
      );
    `);
    this.readState = this.database.prepare("SELECT snapshot FROM world_state WHERE id = 1");
    this.writeState = this.database.prepare(`
      INSERT INTO world_state (id, snapshot) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot
    `);
    this.historyCount = this.database.prepare("SELECT COUNT(*) AS count FROM history");
    this.historyTail = this.database.prepare("SELECT event FROM history ORDER BY id DESC LIMIT 1");
    this.deleteHistory = this.database.prepare("DELETE FROM history");
    this.insertHistory = this.database.prepare("INSERT INTO history (tick, event) VALUES (?, ?)");
    // Keep the snapshot and its history rows consistent if a write fails.
    this.saveTransaction = this.database.transaction((world) => {
      const events = world.events;
      let count = this.historyCount.get().count;
      const tail = this.historyTail.get();
      const matchesTail = count === 0 || JSON.stringify(events[count - 1]) === tail?.event;
      if (count > events.length || !matchesTail) {
        this.deleteHistory.run();
        count = 0;
      }
      for (const event of events.slice(count)) {
        this.insertHistory.run(event.tick, JSON.stringify(event));
      }
      this.writeState.run(JSON.stringify(serializeWorld(world)));
    });
  }

  /** Loads the saved world, or returns the API's default 10x8 floor. */
  load() {
    const row = this.readState.get();
    return row ? deserializeWorld(JSON.parse(row.snapshot)) : createWorld(10, 8);
  }

  /** Writes the world snapshot and any new history events transactionally. */
  save(world) {
    this.saveTransaction(world);
  }

  /** Releases the SQLite connection. */
  close() {
    this.database.close();
  }
}