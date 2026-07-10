"use client";

import { useRef, useState } from "react";
import clsx from "clsx";

export function UploadZone({
  fileName,
  rowCount,
  onFile,
}: {
  fileName: string | null;
  rowCount: number;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={clsx(
        "cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition",
        isDragging ? "border-credits-accent bg-credits-accent/10" : "border-credits-border bg-credits-card"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <p className="text-sm font-medium text-credits-text">
        {fileName ? "Drop a new CSV to replace the current data" : "Drag & drop a CSV here, or click to upload"}
      </p>
      <p className="mt-1 text-xs text-credits-muted">
        {fileName ? `Loaded: ${fileName} · ${rowCount} rows` : "Columns: consumable, operating time, operator, count point consumption"}
      </p>
    </div>
  );
}
