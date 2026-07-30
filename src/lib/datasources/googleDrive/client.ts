import { config } from "../../config";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const CONCURRENCY = 8; // hundreds of folders × 2 calls each — bounded so a sync doesn't hammer the Drive API

interface DriveFile {
  id: string;
  mimeType?: string;
}

interface DriveFileWithDuration extends DriveFile {
  name?: string;
  videoMediaMetadata?: { durationMillis?: string };
}

export interface DriveVideoFile {
  name: string;
  durationSeconds: number | null;
}

export function isGoogleDriveConfigured(): boolean {
  return Boolean(config.googleDrive.apiKey);
}

/** Accepts both ".../folders/ID" and ".../folders/ID?usp=sharing" style links. */
function extractFolderId(driveLink: string): string | null {
  const match = driveLink.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

async function driveGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${DRIVE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", config.googleDrive.apiKey);

  const res = await fetch(url.toString());
  const body = (await res.json()) as T & { error?: { message?: string } };

  if (!res.ok) {
    throw new Error(`Drive API error: ${body.error?.message ?? res.statusText}`);
  }

  return body;
}

// These folders live in a Shared Drive (Team Drive) — without both params, Drive API v3
// returns 404/empty for Shared Drive content regardless of sharing settings. Confirmed against
// a real folder: identical request without these two params 404'd; with them, worked.
const SHARED_DRIVE_PARAMS = { supportsAllDrives: "true", includeItemsFromAllDrives: "true" };

// Most folders hold exactly one video, but confirmed real case: a folder shared across several
// sheet rows (e.g. "3 Messages V1/V2/V3", all three logged against the same Drive folder) can
// hold one file per variation — returning all of them (not just the first) lets the caller match
// each row to its own file instead of every row silently getting whichever file the API happened
// to list first. Capped at 20 — a real "one folder, many variants" case should never come close.
async function findVideoFilesInFolder(folderId: string): Promise<DriveFile[]> {
  const { files } = await driveGet<{ files: DriveFile[] }>("/files", {
    q: `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`,
    fields: "files(id,mimeType,name)",
    pageSize: "20",
    ...SHARED_DRIVE_PARAMS,
  });
  return files;
}

async function getFileWithDuration(fileId: string): Promise<DriveFileWithDuration> {
  return driveGet<DriveFileWithDuration>(`/files/${fileId}`, {
    fields: "name,videoMediaMetadata",
    ...SHARED_DRIVE_PARAMS,
  });
}

function millisToSeconds(ms: string | undefined): number | null {
  return ms ? Math.round(Number(ms) / 1000) : null;
}

async function videoFilesForDriveLink(driveLink: string): Promise<DriveVideoFile[]> {
  const folderId = extractFolderId(driveLink);
  if (!folderId) return [];

  try {
    const files = await findVideoFilesInFolder(folderId);
    const withDurations = await Promise.all(files.map((f) => getFileWithDuration(f.id)));
    return withDurations.map((f) => ({
      name: f.name ?? "",
      durationSeconds: millisToSeconds(f.videoMediaMetadata?.durationMillis),
    }));
  } catch {
    return []; // one bad/inaccessible folder shouldn't take down the whole batch
  }
}

// driveLink -> resolved video files, cached for the process lifetime (same pattern as
// googleSheets/client.ts's gidCacheBySheet) — a video's duration never changes once uploaded, so
// there's no reason to re-fetch it on every sync. Confirmed real case: as the number of
// configured drive-creative sheets grew (7 sheets, 1000+ unique folders after adding Pandit Ji),
// a single sync's Drive lookups grew large enough to trip Drive API rate limiting partway
// through — once that happens, EVERY remaining folder in the batch silently degrades to null
// duration (the existing per-folder try/catch isolates one bad folder, but can't help once the
// rate limit itself kicks in for the rest of the run). Caching means only genuinely NEW links
// need fetching on the second and every subsequent sync, cutting the volume that could ever
// trip the limit again. Only successful non-empty lookups are cached (see below) — a link that
// resolves to zero files (genuinely no video, e.g. a static-image row, OR a transient failure)
// is deliberately left uncached so it's retried fresh next sync rather than permanently frozen.
const durationCacheByLink = new Map<string, DriveVideoFile[]>();

/**
 * Resolves every video file (name + duration) found in each Drive folder link, keyed by the
 * original link string — a folder shared by multiple sheet rows returns multiple entries, and
 * it's the caller's job (syncService.ts) to match each row to the right one by name. Bounded
 * concurrency (not Promise.all on everything at once) — this runs against hundreds of folders
 * per sync, and each folder is now 1 + N Drive API calls (N = video files inside it).
 */
export async function fetchVideoFilesForDriveLinks(driveLinks: string[]): Promise<Map<string, DriveVideoFile[]>> {
  const results = new Map<string, DriveVideoFile[]>();
  if (!isGoogleDriveConfigured()) return results;

  const uniqueLinks = Array.from(new Set(driveLinks));
  const uncachedLinks: string[] = [];

  for (const link of uniqueLinks) {
    const cached = durationCacheByLink.get(link);
    if (cached) {
      results.set(link, cached);
    } else {
      uncachedLinks.push(link);
    }
  }

  for (let i = 0; i < uncachedLinks.length; i += CONCURRENCY) {
    const batch = uncachedLinks.slice(i, i + CONCURRENCY);
    const filesPerLink = await Promise.all(batch.map((link) => videoFilesForDriveLink(link)));
    batch.forEach((link, index) => {
      const files = filesPerLink[index] ?? [];
      if (files.length > 0) durationCacheByLink.set(link, files);
      results.set(link, files);
    });
  }

  return results;
}
