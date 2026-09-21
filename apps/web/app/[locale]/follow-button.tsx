'use client';

import { useState } from 'react';

export function FollowButton({ subjectType, subjectSlug, label }: { subjectType: 'organization' | 'project'; subjectSlug: string; label: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const follow = async () => {
    setState('saving');
    const response = await fetch('/api/v1/follows', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subjectType, subjectSlug }) });
    setState(response.ok ? 'done' : 'error');
  };
  return <button type="button" className="tmk-button tmk-button--secondary" disabled={state === 'saving' || state === 'done'} onClick={() => void follow()}>{state === 'done' ? '✓' : state === 'saving' ? '…' : state === 'error' ? 'أعد المحاولة' : label}</button>;
}
