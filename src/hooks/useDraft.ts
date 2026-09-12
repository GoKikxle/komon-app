import { useEffect, useRef, useState } from 'react';

// Backs draft-persistence for the three creation flows (Create.tsx,
// SplitBillCreate.tsx, PollCreate.tsx's create mode) — none of them
// persisted anything before this, so a reload, tab close, or (for the
// single-page poll form, which has no step to fall back to) any
// navigation away wiped whatever had been entered. Each flow's shape is
// different enough that a shared *draft object* wouldn't make sense, but
// the read/write/expire/restore *mechanism* is identical across all
// three, hence one generic hook rather than three copies of the same
// localStorage bookkeeping.
//
// Autosave, not an exit/back confirmation dialog: this app's router is a
// plain <BrowserRouter> (App.tsx), not a data router, and react-router's
// useBlocker requires one — it throws immediately outside a data router.
// Migrating the whole app to a data router just to block navigation here
// is out of scope for this fix. Even a narrower confirmation (wrapping
// each page's own BackLink onClick) couldn't cover every real exit path
// anyway — a reload, a tab close, or the physical browser-back gesture
// none of them run any in-app onClick at all. Autosave-as-draft sidesteps
// the gap entirely: however the page is left, the draft is just there
// next time the same URL loads.
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredDraft<T> {
  value: T;
  savedAt: number;
}

function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft<T>>;
    if (!parsed || typeof parsed.savedAt !== 'number' || !('value' in parsed)) return null;
    // Don't resurrect a long-abandoned draft indefinitely — anything past
    // this age is silently dropped (and cleaned up) rather than restored.
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.value as T;
  } catch {
    // Corrupt JSON, or localStorage unavailable (private browsing in some
    // browsers throws on access) — a draft is a convenience, never worth
    // crashing the page over.
    return null;
  }
}

function writeDraft<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() } satisfies StoredDraft<T>));
  } catch {
    // Quota exceeded or unavailable — same reasoning as readDraft's catch.
  }
}

function removeDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

interface UseDraftOptions<T> {
  /** Storage key. Ignored while `enabled` is false, so a caller that has
   *  no real key yet (e.g. userId not resolved) can pass an empty string. */
  key: string;
  /** Gates both restoring and saving. False for PollCreate.tsx's edit
   *  mode specifically — an existing poll being edited must always load
   *  fresh from the server (see that file's own fetch effect), never
   *  from a stale local draft; this hook is simply never engaged there. */
  enabled: boolean;
  /** The live, current form state, assembled fresh by the caller every
   *  render (a plain object literal of whatever fields that flow wants
   *  persisted — omit anything unserializable, like a File or a blob:
   *  URL that dies on reload). */
  value: T;
  /** Called at most once per mount, only if a non-expired draft was
   *  found — apply it via the flow's own setState calls. */
  onRestore: (draft: T) => void;
}

export function useDraft<T>({ key, enabled, value, onRestore }: UseDraftOptions<T>) {
  const [restored, setRestored] = useState(false);
  const restoreAttempted = useRef(false);
  const finished = useRef(false);
  // Read via a ref rather than putting onRestore in the effect's own
  // deps below — the caller passes a fresh closure every render, which
  // would otherwise force that effect to re-run constantly; the ref
  // always has the latest version without that.
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // Restore once, as soon as `enabled` turns true (typically once auth
  // resolves and a real per-user key exists). Guarded so it only ever
  // fires once per mount — onRestore's own setState calls change `value`
  // on the next render, which would otherwise make this effect (if it
  // depended on `value`) restore repeatedly.
  useEffect(() => {
    if (!enabled || restoreAttempted.current) return;
    restoreAttempted.current = true;
    const draft = readDraft<T>(key);
    if (draft) {
      onRestoreRef.current(draft);
      setRestored(true);
    }
  }, [enabled, key]);

  // Autosave on every change, once the restore attempt above has had its
  // chance to run first (so a freshly-mounted form doesn't immediately
  // overwrite a not-yet-read draft with its own pristine defaults).
  useEffect(() => {
    if (!enabled || !restoreAttempted.current || finished.current) return;
    writeDraft(key, value);
  }, [enabled, key, value]);

  // Called on successful submit — stops any further autosaving and
  // clears the now-obsolete draft, so a later fresh visit to the same
  // form doesn't restore a gathering/poll that's already been created.
  function markSubmitted() {
    finished.current = true;
    removeDraft(key);
  }

  // The banner's "Start fresh instead" action. Reloading (rather than
  // resetting each field by hand) guarantees a genuinely clean form with
  // no risk of missing a field in a manual reset — acceptable here since
  // this is a deliberate, infrequent action, not part of the normal flow.
  function discard() {
    finished.current = true;
    removeDraft(key);
    window.location.reload();
  }

  return { restored, markSubmitted, discard };
}
