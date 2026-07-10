import type { ProgressItem } from "../types";
import { store } from "../cache/store";

export interface ProgressRepository {
  getAll(): Promise<ProgressItem[]>;
  replaceAll(items: ProgressItem[]): Promise<void>;
}

class InMemoryProgressRepository implements ProgressRepository {
  async getAll(): Promise<ProgressItem[]> {
    return store.progress;
  }

  async replaceAll(items: ProgressItem[]): Promise<void> {
    store.progress = items;
  }
}

export const progressRepository: ProgressRepository = new InMemoryProgressRepository();
