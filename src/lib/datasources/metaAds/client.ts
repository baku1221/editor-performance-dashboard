import { config, isMetaAdsConfigured } from "../../config";

const GRAPH_BASE = "https://graph.facebook.com";

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number };
}

/** Thin wrapper over the Meta Graph API. No SDK dependency — one fetch, one concern. */
export async function metaGraphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!isMetaAdsConfigured()) {
    throw new Error(
      "Meta Ads API is not configured. Set META_ACCESS_TOKEN and META_AD_ACCOUNT_IDS in .env.local."
    );
  }

  const url = new URL(`${GRAPH_BASE}/${config.metaAds.apiVersion}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", config.metaAds.accessToken);

  const res = await fetch(url.toString());
  const body = (await res.json()) as T & GraphErrorBody;

  if (!res.ok || body.error) {
    throw new Error(`Meta Graph API error: ${body.error?.message ?? res.statusText}`);
  }

  return body;
}

/**
 * Follows `paging.next` until exhausted. Meta Graph API next links already carry the token/params.
 *
 * A failed page THROWS rather than silently stopping — a prior version broke the loop on any
 * non-ok page, which meant a single failure partway through pagination silently truncated the
 * result set (discovered via a real account: page 4 of an ads listing 500'd consistently,
 * quietly losing every ad after it with no error surfaced anywhere). Sync failing loudly on a
 * partial fetch beats sync succeeding with wrong, under-counted data.
 */
export async function metaGraphGetAllPages<Item>(
  path: string,
  params: Record<string, string>
): Promise<Item[]> {
  type Page = { data: Item[]; paging?: { next?: string } };

  const results: Item[] = [];
  let page = await metaGraphGet<Page>(path, params);
  results.push(...page.data);

  while (page.paging?.next) {
    const res = await fetch(page.paging.next);
    const body = (await res.json()) as Page & GraphErrorBody;
    if (!res.ok || body.error) {
      throw new Error(`Meta Graph API error (mid-pagination, ${results.length} items already fetched): ${body.error?.message ?? res.statusText}`);
    }
    page = body;
    results.push(...page.data);
  }

  return results;
}

const MULTI_ID_CHUNK_SIZE = 50;

/** Batch-fetches multiple node ids via `?ids=a,b,c` — one call per 50 ids, keyed by id in the response. */
export async function metaGraphGetByIds<Item>(ids: string[], fields: string): Promise<Record<string, Item>> {
  if (ids.length === 0) return {};

  const merged: Record<string, Item> = {};

  for (let i = 0; i < ids.length; i += MULTI_ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + MULTI_ID_CHUNK_SIZE);
    const page = await metaGraphGet<Record<string, Item>>("", { ids: chunk.join(","), fields });
    Object.assign(merged, page);
  }

  return merged;
}
