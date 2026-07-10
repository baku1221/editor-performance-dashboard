import { config } from "../../config";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const CONCURRENCY = 8; // hundreds of folders × 2 calls each — bounded so a sync doesn't hammer the Drive API

interface DriveFile {
  id: string;
  mimeType?: string;
}

interface DriveFileWithDuration extends DriveFile {
  videoMediaMetadata?: { durationMillis?: string };
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

async function findVideoFileInFolder(folderId: string): Promise<string | null> {
  const { files } = await driveGet<{ files: DriveFile[] }>("/files", {
    q: `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`,
    fields: "files(id,mimeType)",
    pageSize: "5",
    ...SHARED_DRIVE_PARAMS,
  });
  return files[0]?.id ?? null;
}

async function getFileDurationSeconds(fileId: string): Promise<number | null> {
  const file = await driveGet<DriveFileWithDuration>(`/files/${fileId}`, {
    fields: "videoMediaMetadata",
    ...SHARED_DRIVE_PARAMS,
  });
  const ms = file.videoMediaMetadata?.durationMillis;
  return ms ? Math.round(Number(ms) / 1000) : null;
}

async function durationForDriveLink(driveLink: string): Promise<number | null> {
  const folderId = extractFolderId(driveLink);
  if (!folderId) return null;

  try {
    const videoFileId = await findVideoFileInFolder(folderId);
    if (!videoFileId) return null;
    return await getFileDurationSeconds(videoFileId);
  } catch {
    return null; // one bad/inaccessible folder shouldn't take down the whole batch
  }
}

/**
 * Resolves duration for a batch of Drive folder links, keyed by the original link string.
 * Bounded concurrency (not Promise.all on everything at once) — this runs against hundreds of
 * folders per sync, two Drive API calls each.
 */
export async function fetchDurationsForDriveLinks(driveLinks: string[]): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  if (!isGoogleDriveConfigured()) return results;

  const uniqueLinks = Array.from(new Set(driveLinks));

  for (let i = 0; i < uniqueLinks.length; i += CONCURRENCY) {
    const batch = uniqueLinks.slice(i, i + CONCURRENCY);
    const durations = await Promise.all(batch.map((link) => durationForDriveLink(link)));
    batch.forEach((link, index) => {
      const duration = durations[index];
      if (duration !== null && duration !== undefined) results.set(link, duration);
    });
  }

  return results;
}
