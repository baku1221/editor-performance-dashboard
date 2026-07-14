import { promises as fs } from "fs";
import path from "path";
import type { EditorRosterEntry } from "../config";
import { config } from "../config";

// Editors added through the dashboard's "Add editor" UI, on top of the baseline EDITOR_ROSTER
// env var. File-based (not the in-memory `store`) specifically so a new editor survives a plain
// server restart, not just Next.js dev-mode module reloads — this is meant to be a durable roster
// change, not ephemeral session state. Note this still won't survive a fresh container/redeploy
// on hosts with an ephemeral filesystem (e.g. Railway without a mounted volume); EDITOR_ROSTER
// remains the source of truth for editors that must never disappear.
const DATA_FILE = path.join(process.cwd(), "data", "custom-editors.json");

export interface EditorRosterRepository {
  getCustom(): Promise<EditorRosterEntry[]>;
  add(entry: EditorRosterEntry): Promise<void>;
  /** Baseline EDITOR_ROSTER (env) + every custom editor added via the UI, merged. */
  getEffective(): Promise<EditorRosterEntry[]>;
}

class FileEditorRosterRepository implements EditorRosterRepository {
  private cache: EditorRosterEntry[] | null = null;

  private async load(): Promise<EditorRosterEntry[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(DATA_FILE, "utf-8");
      this.cache = JSON.parse(raw) as EditorRosterEntry[];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  async getCustom(): Promise<EditorRosterEntry[]> {
    return this.load();
  }

  async add(entry: EditorRosterEntry): Promise<void> {
    const all = await this.load();
    all.push(entry);
    this.cache = all;
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(all, null, 2));
  }

  async getEffective(): Promise<EditorRosterEntry[]> {
    return [...config.editorRoster, ...(await this.load())];
  }
}

export const editorRosterRepository: EditorRosterRepository = new FileEditorRosterRepository();
