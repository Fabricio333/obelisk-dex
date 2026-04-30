'use client';

/**
 * Image URL input with a Blossom upload button — same visual pattern as the
 * legacy obelisk admin (preview thumbnail · URL input · "Upload" pill).
 *
 * Reuse anywhere a user can pick an image URL: profile picture/banner,
 * group icon/banner, emoji uploads, etc. Falls back gracefully when the
 * Blossom servers are unreachable: shows the upload error inline; the URL
 * field stays usable.
 */

import { useState } from 'react';

interface Props {
  label: string;
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  /** Thumbnail aspect — `square` for icons/avatars, `wide` for banners. */
  shape?: 'square' | 'wide';
  /** Optional helper text rendered under the input. */
  hint?: React.ReactNode;
  /** Restrict the file picker (default: any image). */
  accept?: string;
}

export default function BlossomImageInput({
  label,
  value,
  onChange,
  placeholder = 'https://… or upload',
  shape = 'square',
  hint,
  accept = 'image/*',
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { uploadToBlossom } = await import('@/lib/blossom');
      const url = await uploadToBlossom(file);
      onChange(url);
    } catch (err) {
      setError((err as Error).message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const thumbCls =
    shape === 'wide'
      ? 'w-24 h-12 rounded-lg object-cover bg-lc-black border border-lc-border'
      : 'w-12 h-12 rounded-lg object-cover bg-lc-black border border-lc-border';
  const placeholderCls =
    shape === 'wide'
      ? 'w-24 h-12 rounded-lg bg-lc-black border border-lc-border'
      : 'w-12 h-12 rounded-lg bg-lc-black border border-lc-border';

  return (
    <div>
      <label className="block text-xs text-lc-muted mb-1.5 uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className={thumbCls} />
        ) : (
          <div className={placeholderCls} />
        )}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg bg-lc-black border border-lc-border text-lc-white text-sm focus:border-lc-green focus:outline-none transition-colors"
        />
        <label className="lc-pill lc-pill-secondary text-xs cursor-pointer whitespace-nowrap">
          {uploading ? 'Uploading…' : 'Upload'}
          <input
            type="file"
            accept={accept}
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      {hint && <p className="mt-1.5 text-[11px] text-lc-muted">{hint}</p>}
    </div>
  );
}
