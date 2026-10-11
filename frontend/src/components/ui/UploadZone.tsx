'use client';

import React, { useRef, useState } from 'react';
import { FileCheck2, UploadCloud, X } from 'lucide-react';

interface UploadZoneProps {
  label: string;
  sublabel?: string;
  accept?: string;
  maxSizeMb?: number;
  onFileSelect: (file: File | null) => void;
  selectedFile?: File | null;
}

export function UploadZone({
  label,
  sublabel = 'Arrastra un archivo o haz clic para elegirlo',
  accept = 'image/*,video/*',
  maxSizeMb = 50,
  onFileSelect,
  selectedFile,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files[0]);
    }
  };

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileSelect(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`relative flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed text-center transition-colors ${
        selectedFile ? 'p-3' : 'px-5 py-7'
      } ${
        isDragging
          ? 'border-accent bg-accent/5'
          : selectedFile
            ? 'border-line bg-surface-2/60'
            : 'border-line-strong hover:border-fg-subtle hover:bg-surface-2/50'
      }`}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />

      {selectedFile ? (
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-fg">
              <FileCheck2 className="h-4 w-4" />
            </span>
            <div className="min-w-0 text-left">
              <p className="truncate text-[13px] font-medium text-fg">{selectedFile.name}</p>
              <p className="text-[12px] tabular-nums text-fg-subtle">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={removeFile}
            aria-label="Quitar archivo"
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          <UploadCloud className={`mb-2.5 h-5 w-5 ${isDragging ? 'text-accent' : 'text-fg-subtle'}`} />
          <p className="text-[13px] font-medium text-fg">{label}</p>
          <p className="mt-1 text-[12px] text-fg-subtle">{sublabel}</p>
          <p className="mt-2 text-[11px] text-fg-subtle/80">Máximo {maxSizeMb} MB</p>
        </>
      )}
    </div>
  );
}
