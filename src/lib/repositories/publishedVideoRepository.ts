import type { PublishedVideo } from "../types";
import { store } from "../cache/store";

// Interface first: everything above this line is what services depend on.
// A future Postgres/Mongo-backed implementation only needs to satisfy this
// shape and get swapped in below — no service or API route changes.
export interface PublishedVideoRepository {
  getAll(): Promise<PublishedVideo[]>;
  replaceAll(videos: PublishedVideo[]): Promise<void>;
  getManualOverrides(): Promise<Map<string, boolean>>;
  /** Pass `null` to clear an override and fall back to the automatic winning rule. */
  setManualOverride(videoId: string, isWinning: boolean | null): Promise<void>;
}

class InMemoryPublishedVideoRepository implements PublishedVideoRepository {
  async getAll(): Promise<PublishedVideo[]> {
    return store.publishedVideos;
  }

  async replaceAll(videos: PublishedVideo[]): Promise<void> {
    store.publishedVideos = videos;
  }

  async getManualOverrides(): Promise<Map<string, boolean>> {
    return store.manualWinningOverrides;
  }

  async setManualOverride(videoId: string, isWinning: boolean | null): Promise<void> {
    if (isWinning === null) {
      store.manualWinningOverrides.delete(videoId);
    } else {
      store.manualWinningOverrides.set(videoId, isWinning);
    }
  }
}

export const publishedVideoRepository: PublishedVideoRepository = new InMemoryPublishedVideoRepository();
