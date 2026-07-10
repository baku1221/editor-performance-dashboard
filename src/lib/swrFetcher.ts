export async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}
