/** Per-browser conveniences (never scenario data, which lives in the link). Storage may be blocked; then defaults apply. */
const PREFIX = 'lsn-';

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage blocked: the setting lasts for this visit only */
  }
}
