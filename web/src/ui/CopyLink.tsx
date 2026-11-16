import { useEffect, useState } from 'react';

/** Copies a short text, such as coordinates, and says so for a moment. */
export function CopyText({ text, label, what }: { text: string; label: string; what: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      className="btn ghost small"
      type="button"
      aria-label={`Copy ${what}: ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          window.prompt(`Copy the ${what}`, text);
        }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

/** Copies the current URL, which carries every scenario in its hash. */
export function CopyLink({ label = 'Copy link' }: { label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState('copied');
    } catch {
      // Clipboard blocked: show the link so it can be copied by hand.
      window.prompt('Copy this link', window.location.href);
      setState('failed');
    }
  };
  return (
    <button className="btn small" type="button" onClick={copy} aria-live="polite">
      {state === 'copied' ? 'Link copied' : label}
    </button>
  );
}
