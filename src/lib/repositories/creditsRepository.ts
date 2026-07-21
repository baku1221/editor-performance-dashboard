import type { CreditRow } from "../creditsDashboard";
import { store } from "../cache/store";

export interface CreditsData {
  rows: CreditRow[];
  fileName: string;
  uploadedAt: string;
}

export interface CreditsRepository {
  get(): Promise<CreditsData | null>;
  replace(data: CreditsData): Promise<void>;
}

class InMemoryCreditsRepository implements CreditsRepository {
  async get(): Promise<CreditsData | null> {
    return store.creditsData;
  }

  async replace(data: CreditsData): Promise<void> {
    store.creditsData = data;
  }
}

export const creditsRepository: CreditsRepository = new InMemoryCreditsRepository();
