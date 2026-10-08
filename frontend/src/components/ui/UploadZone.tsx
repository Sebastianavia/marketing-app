'use client';

import React, { useState, useRef } from 'react';
import { Upload, X, Check } from 'lucide-react';

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
  sublabel = 'Arrastra un archivo o haz clic para explorar',
  accept = 'image/*,video/*',
  maxSizeMb = 50,
  onFileSelect,
  selectedFile,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

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
      onClick={() => inputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center justify-center rounded-lg border border-dashed p-5 text-center transition-all cursor-pointer ${
        isDragging
          ? 'border-indigo-500 bg-indigo-50/50 dark:border-white/40 dark:bg-zinc-900/60'
          : selectedFile
          ? 'border-emerald-500/50 bg-emerald-500/5 dark:border-zinc-700 dark:bg-zinc-900/30'
          : 'border-slate-300 bg-slate-50/50 hover:border-slate-400 hover:bg-slate-100/50 dark:border-white/[0.1] dark:bg-zinc-950/40 dark:hover:border-white/[0.2] dark:hover:bg-zinc-900/20'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />

      {selectedFile ? (
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
              <Check className="h-3.5 w-3.5" />
            </div>
            <div className="text-left overflow-hidden">
              <p className="truncate text-xs font-medium text-slate-900 dark:text-zinc-200">
                {selectedFile.name}
              </p>
              <p className="font-mono text-[10px] text-slate-500 dark:text-zinc-500">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={removeFile}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200 dark:text-zinc-500 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 py-1">
          <Upload className="h-4 w-4 text-slate-400 dark:text-zinc-500 mb-0.5" />
          <p className="text-xs font-medium text-slate-800 dark:text-zinc-300">{label}</p>
          <p className="text-[11px] text-slate-500 dark:text-zinc-500">{sublabel}</p>
          <span className="font-mono text-[10px] text-slate-400 dark:text-zinc-600 mt-1">
            Máx. {maxSizeMb} MB
          </span>
        </div>
      )}
    </div>
  );
}
