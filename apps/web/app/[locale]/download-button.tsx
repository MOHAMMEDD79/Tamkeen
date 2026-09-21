'use client';

import { useState } from 'react';

export function DownloadButton({ endpoint, label }: { endpoint: string; label: string }) {
  const [error, setError] = useState(false);
  const download = async () => {
    setError(false);
    const response = await fetch(`/api/v1${endpoint}`, { credentials: 'include' });
    const payload = await response.json().catch(() => null) as { data?: { filename?: string; mimeType?: string; content?: string } } | null;
    if (!response.ok || !payload?.data?.content) { setError(true); return; }
    const url = URL.createObjectURL(new Blob([payload.data.content], { type: payload.data.mimeType ?? 'application/octet-stream' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = payload.data.filename ?? 'download'; anchor.click(); URL.revokeObjectURL(url);
  };
  return <button className="tmk-button tmk-button--secondary" type="button" onClick={() => void download()}>{error ? 'أعد المحاولة' : label}</button>;
}
