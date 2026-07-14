"use client";

import { useState } from "react";
import clsx from "clsx";

export function AddEditorButton({ onAdded }: { onAdded: (name: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setIsOpen(false);
    setName("");
    setAliases("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/editors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          aliases: aliases
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't add editor.");
        return;
      }
      onAdded(name.trim());
      close();
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="rounded-lg border border-app-border px-2.5 py-1.5 text-sm text-app-muted transition hover:bg-app-border hover:text-app-text"
      >
        + Add editor
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <div
            className="w-full max-w-sm rounded-2xl border border-app-border bg-app-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold text-app-text">Add editor</h3>
            <p className="mb-4 text-xs text-app-muted">
              New editors are recognized on the next sync — click "Sync now" afterward to pull in their ads.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-app-muted">Name</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Priya"
                  className="w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-purple-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-app-muted">
                  Aliases <span className="text-app-dim">(optional, comma-separated)</span>
                </label>
                <input
                  value={aliases}
                  onChange={(e) => setAliases(e.target.value)}
                  placeholder="e.g. spelling variants seen in ad titles"
                  className="w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-purple-400 focus:outline-none"
                />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg px-3 py-1.5 text-sm text-app-muted hover:bg-app-border"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !name.trim()}
                  className={clsx(
                    "rounded-lg px-3 py-1.5 text-sm font-medium text-white transition",
                    isSubmitting || !name.trim() ? "bg-app-border" : "bg-purple-600 hover:bg-purple-500"
                  )}
                >
                  {isSubmitting ? "Adding…" : "Add editor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
