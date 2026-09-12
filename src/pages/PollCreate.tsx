import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Switch } from '@base-ui/react/switch';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { useDraft } from '../hooks/useDraft';
import { BackLink } from '../components/BackLink';
import {
  createPoll,
  fetchLinkPreview,
  fetchPoll,
  fetchPollOptions,
  formatCloseCountdown,
  initialsBadge,
  OptionImageTooLargeError,
  optionMonogram,
  parseLinkMeta,
  pollErrorToast,
  pollHasVotes,
  updatePoll,
  uploadPollOptionImage,
  type CreatePollOptionInput,
} from '../data/polls';
import type { AliasPollOption, LinkMeta } from '../lib/database.types';

interface DraftOption {
  key: string;
  label: string;
  imageFile: File | null;
  imagePreview: string | null;
  linkUrl: string;
  linkMeta: LinkMeta | null;
  linkChecking: boolean;
}

let optKeySeq = 0;
function newOption(): DraftOption {
  optKeySeq += 1;
  return { key: `opt${optKeySeq}`, label: '', imageFile: null, imagePreview: null, linkUrl: '', linkMeta: null, linkChecking: false };
}

// Maps a persisted option (edit mode's initial load) into the same draft
// shape the create form already edits — imagePreview holds the real
// image_url string here (not a fresh blob: URL), and imageFile stays null
// since nothing's been freshly picked; resolveOptions below treats "no
// imageFile but an imagePreview" as "keep this already-uploaded image" for
// exactly this reason.
function draftFromOption(o: AliasPollOption): DraftOption {
  optKeySeq += 1;
  return {
    key: `opt${optKeySeq}`,
    label: o.label,
    imageFile: null,
    imagePreview: o.image_url,
    linkUrl: o.link_url || '',
    linkMeta: o.link_meta,
    linkChecking: false,
  };
}

// Product decision: 3, not the 5 an earlier round of this feature
// targeted — "+ Add option" below disables itself once this is hit, same
// spot removeOption already floors at 2 (options.length > 2 there).
const MAX_POLL_OPTIONS = 3;

// What useDraft.ts (see that file) persists for create mode — label,
// linkUrl, and linkMeta only. imageFile (a File) isn't JSON-serializable,
// and imagePreview, for a freshly-picked local file, is a blob: URL that
// dies the moment the tab reloads — same reasoning as Create.tsx's own
// cover-image exclusion. A restored draft's options come back with no
// image; the organizer just re-adds it.
interface PollDraftOption {
  label: string;
  linkUrl: string;
  linkMeta: LinkMeta | null;
}

interface PollDraft {
  title: string;
  options: PollDraftOption[];
  allowMessages: boolean;
  suspenseMode: boolean;
  commentsLive: boolean;
  durationMs: number;
}

function draftOptionFromPersisted(o: PollDraftOption): DraftOption {
  optKeySeq += 1;
  return { key: `opt${optKeySeq}`, label: o.label, imageFile: null, imagePreview: null, linkUrl: o.linkUrl, linkMeta: o.linkMeta, linkChecking: false };
}

// No duration-picker Figma frame exists for this — built from Komon's
// existing .radio-group/.radio-chip pattern (Create.tsx's Split Method /
// Pay Method pickers) instead. 4 presets; default 7 days in create mode.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DURATION_PRESETS: [number, string][] = [
  [12 * HOUR, '12 hours'],
  [1 * DAY, '1 day'],
  [3 * DAY, '3 days'],
  [7 * DAY, '7 days'],
];

// Figma-less feature (built from the reviewed prototype, not a Figma pull)
// — Alias Polls' Create screen, and (round 4) also its Edit screen: one
// component, dual mode via the optional :id route param, rather than a
// second parallel ~500-line file the way Create.tsx/Edit.tsx duplicate
// each other for gatherings — that duplication is that pair's own actual
// precedent, not something worth copying here.
//
// Round 4 also rebuilt this into Create.tsx's own "form + live preview"
// two-column pattern (.create-layout / .preview-wrap) instead of the
// poll-specific single-column stack this used to be, and removed the
// chart-style picker (Row card vs Columns) entirely — PollTally now only
// ever renders one layout, so there's nothing left to choose here.
export function PollCreate() {
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();
  const { userId, ready, isPersistent } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (ready && !isPersistent) {
      const next = id ? `/poll/${id}/edit` : '/poll/new';
      navigate(`/signin?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [ready, isPersistent, id, navigate]);

  const [title, setTitle] = useState('');
  const [options, setOptions] = useState<DraftOption[]>([newOption(), newOption()]);
  const [allowMessages, setAllowMessages] = useState(true);
  const [suspenseMode, setSuspenseMode] = useState(true);
  const [commentsLive, setCommentsLive] = useState(true);
  const [durationMs, setDurationMs] = useState(7 * DAY);
  const [submitting, setSubmitting] = useState(false);

  // --- Edit mode: load the existing poll + options + vote-lock state ---
  const [editOrganizerId, setEditOrganizerId] = useState<string | null>(null);
  const [editNotFound, setEditNotFound] = useState(false);
  const [editLoading, setEditLoading] = useState(isEditMode);
  const [optionsLocked, setOptionsLocked] = useState(false);
  // The poll's current closes_at, for the read-only "currently closes in…"
  // context line. selectedDurationMs stays null ("unchanged") unless the
  // organizer actively clicks a preset — there's no clean way to map an
  // arbitrary remaining duration back onto one of the 4 fixed presets, so
  // none is pre-selected.
  const [currentClosesAt, setCurrentClosesAt] = useState<string | null>(null);
  const [selectedDurationMs, setSelectedDurationMs] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    Promise.all([fetchPoll(id), fetchPollOptions(id), pollHasVotes(id)])
      .then(([p, opts, hasVotes]) => {
        if (!mounted) return;
        if (!p) {
          setEditNotFound(true);
          return;
        }
        setEditOrganizerId(p.organizer_user_id);
        setTitle(p.title);
        setOptions(opts.map(draftFromOption));
        setOptionsLocked(hasVotes);
        setCurrentClosesAt(p.closes_at);
        // Seeds the same three state variables the create form's own
        // toggles already use — the toggle-group JSX below no longer
        // hides itself in edit mode, so these need real starting values
        // instead of the create-mode defaults declared above.
        setAllowMessages(p.allow_messages);
        setSuspenseMode(p.suspense_mode);
        setCommentsLive(p.comments_live);
      })
      .catch((err) => {
        console.error(err);
        if (mounted) setEditNotFound(true);
      })
      .finally(() => {
        if (mounted) setEditLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  // Create mode only (enabled: !isEditMode) — an existing poll being
  // edited always loads from the effect above, never from a local draft;
  // this hook is simply never engaged on the /poll/:id/edit route, so
  // there's no ordering to get right between the two, only mutual
  // exclusion by route.
  const { restored: draftRestored, markSubmitted: markDraftSubmitted, discard: discardDraft } = useDraft<PollDraft>({
    key: userId ? `komon-draft-create-poll-${userId}` : '',
    enabled: !isEditMode && Boolean(userId),
    value: {
      title,
      options: options.map((o) => ({ label: o.label, linkUrl: o.linkUrl, linkMeta: o.linkMeta })),
      allowMessages,
      suspenseMode,
      commentsLive,
      durationMs,
    },
    onRestore: (d) => {
      setTitle(d.title);
      setOptions(d.options.length ? d.options.map(draftOptionFromPersisted) : [newOption(), newOption()]);
      setAllowMessages(d.allowMessages);
      setSuspenseMode(d.suspenseMode);
      setCommentsLive(d.commentsLive);
      setDurationMs(d.durationMs);
    },
  });

  function updateOption(key: string, patch: Partial<DraftOption>) {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  function addOption() {
    setOptions((prev) => (prev.length >= MAX_POLL_OPTIONS ? prev : [...prev, newOption()]));
  }

  function removeOption(key: string) {
    setOptions((prev) => (prev.length > 2 ? prev.filter((o) => o.key !== key) : prev));
  }

  async function handleImageChange(key: string, file: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('That file is a bit large (over 5MB) — try a smaller one.');
      return;
    }
    updateOption(key, { imageFile: file, imagePreview: URL.createObjectURL(file) });
  }

  function removeImage(key: string) {
    updateOption(key, { imageFile: null, imagePreview: null });
  }

  // Debounced: parseLinkMeta runs instantly on every keystroke for the
  // status label, but the real server-side scrape only fires once typing
  // pauses — no reason to hit the endpoint on every character.
  function handleLinkChange(key: string, value: string) {
    const meta = value.trim() ? parseLinkMeta(value.trim()) : null;
    updateOption(key, { linkUrl: value, linkMeta: meta, linkChecking: Boolean(meta) });
    if (!meta) return;
    const val = value.trim();
    window.setTimeout(async () => {
      // Stale-response guard: re-read current state before applying —
      // if the field changed again since this timer was set, drop the result.
      const preview = await fetchLinkPreview(val);
      setOptions((prev) =>
        prev.map((o) => {
          if (o.key !== key || o.linkUrl.trim() !== val) return o;
          const resolvedMeta: LinkMeta = {
            host: preview?.host || meta.host,
            name: (preview?.title && preview.title.trim()) || meta.name,
            imageUrl: preview?.imageUrl ?? null,
          };
          return { ...o, linkMeta: resolvedMeta, linkChecking: false, label: o.label.trim() ? o.label : resolvedMeta.name };
        })
      );
    }, 500);
  }

  // Shared by both create and save-changes: uploads any freshly-picked
  // image files and resolves each draft option into the shape the server
  // expects. For a draft carrying no imageFile but an existing
  // imagePreview (edit mode's initial load, before any change), that
  // imagePreview *is* the already-uploaded image_url — passed through
  // as-is rather than re-uploaded.
  async function resolveOptions(drafts: DraftOption[]): Promise<CreatePollOptionInput[]> {
    const resolved: CreatePollOptionInput[] = [];
    for (const opt of drafts) {
      let imageUrl: string | null = opt.imageFile ? null : opt.imagePreview;
      if (opt.imageFile) {
        imageUrl = await uploadPollOptionImage(opt.imageFile, userId!);
      }
      resolved.push({
        label: opt.label.trim(),
        image_url: imageUrl,
        link_url: opt.linkUrl.trim() || null,
        link_meta: opt.linkUrl.trim() ? opt.linkMeta : null,
      });
    }
    return resolved;
  }

  async function handleSubmit() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      toast('Add a question first');
      return;
    }
    if (!userId) {
      toast('Still setting things up — try again in a moment');
      return;
    }

    if (isEditMode) {
      if (!id) return;
      let optionsInput: CreatePollOptionInput[] | undefined;
      if (!optionsLocked) {
        const cleanOptions = options.filter((o) => o.label.trim().length);
        if (cleanOptions.length < 2) {
          toast('Add at least two options first');
          return;
        }
        setSubmitting(true);
        try {
          optionsInput = await resolveOptions(cleanOptions);
        } catch (err) {
          if (err instanceof OptionImageTooLargeError) {
            toast(err.message);
            setSubmitting(false);
            return;
          }
          console.error(err);
          toast(pollErrorToast('saving', err));
          setSubmitting(false);
          return;
        }
      } else {
        setSubmitting(true);
      }
      try {
        await updatePoll(id, {
          title: cleanTitle,
          allowMessages,
          suspenseMode,
          commentsLive,
          options: optionsInput,
          // Omitted entirely (not just re-sent) when the organizer left
          // duration untouched — updatePoll only writes closes_at when
          // this key is present, so the existing value stays as-is.
          ...(selectedDurationMs != null ? { closesAt: new Date(Date.now() + selectedDurationMs).toISOString() } : {}),
        });
        navigate(`/poll/${id}/organize`);
      } catch (err) {
        console.error(err);
        toast(pollErrorToast('saving', err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const cleanOptions = options.filter((o) => o.label.trim().length);
    if (cleanOptions.length < 2) {
      toast('Add at least two options first');
      return;
    }

    setSubmitting(true);
    try {
      let resolvedOptions: CreatePollOptionInput[];
      try {
        resolvedOptions = await resolveOptions(cleanOptions);
      } catch (err) {
        if (err instanceof OptionImageTooLargeError) {
          toast(err.message);
          setSubmitting(false);
          return;
        }
        throw err;
      }

      const pollId = await createPoll({
        organizerId: userId,
        title: cleanTitle,
        suspenseMode,
        commentsLive,
        allowMessages,
        closesAt: new Date(Date.now() + durationMs).toISOString(),
        options: resolvedOptions,
      });
      markDraftSubmitted();
      navigate(`/poll/${pollId}/created`);
    } catch (err) {
      console.error(err);
      toast(pollErrorToast('creating', err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready || !isPersistent || (isEditMode && editLoading)) {
    return (
      <div className="wrap">
        <p className="lede">Loading…</p>
      </div>
    );
  }

  if (isEditMode && editNotFound) {
    return (
      <div className="wrap">
        <BackLink label="Board" onClick={() => navigate('/')} />
        <p className="lede">Poll not found.</p>
      </div>
    );
  }

  if (isEditMode && editOrganizerId !== null && editOrganizerId !== userId) {
    return (
      <div className="wrap">
        <BackLink label="Poll" onClick={() => navigate(`/poll/${id}/organize`)} />
        <p className="lede">Only the organizer can edit this poll.</p>
      </div>
    );
  }

  // Mirrors Create.tsx's own "always show something" preview convention:
  // options with an empty label are skipped (same filter handleSubmit's
  // own cleanOptions applies), but if every option is still empty (the
  // common case right after landing on this page) the raw draft list is
  // shown instead so the preview isn't blank while someone's still typing.
  const nonEmptyOptions = options.filter((o) => o.label.trim().length);
  const previewOptions = nonEmptyOptions.length ? nonEmptyOptions : options;

  return (
    <div className="poll-create-page">
      <div className="wrap">
        <div className="create-layout">
          <div>
            <BackLink
              label={isEditMode ? 'Poll' : 'New poll'}
              onClick={() => navigate(isEditMode ? `/poll/${id}/organize` : '/')}
            />
            <h1>{isEditMode ? 'Edit poll' : 'Set up a poll'}</h1>
            {!isEditMode && (
              <p className="lede">
                No group chat, no shared contacts. Anyone with the link can vote under an alias — you're the only one who
                ever sees a real name.
              </p>
            )}

            {/* Create mode only — draftRestored can never be true in edit
                mode (useDraft's `enabled` above is gated on !isEditMode),
                so no isEditMode check is needed here too. */}
            {draftRestored && (
              <div className="draft-banner">
                <span>Continuing where you left off.</span>
                <button type="button" className="link-btn" onClick={discardDraft}>
                  Start fresh instead
                </button>
              </div>
            )}

            <div className="field">
              <label>Question</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Boy or girl?" />
            </div>

            <div className="field">
              <label>Options</label>
              {!optionsLocked && (
                <p className="field-hint">
                  Add an image or GIF to each — it rides the bar on the results chart
                </p>
              )}
            </div>

            {optionsLocked ? (
              <div>
                <p className="mode-note">Options are locked once voting starts.</p>
                <ul className="item-breakdown">
                  {options.map((opt) => (
                    <li key={opt.key}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="poll-locked-opt-thumb">{optionBadgeContent(opt)}</span>
                        {opt.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                {options.map((opt) => (
                  <div className="poll-opt-block" key={opt.key}>
                    <div className="poll-opt-row">
                      <div className="poll-opt-avatar-wrap">
                        <button
                          type="button"
                          className={`poll-opt-avatar-btn${opt.imagePreview || opt.linkMeta ? ' has-image' : ''}`}
                          onClick={() => document.getElementById(`poll-opt-file-${opt.key}`)?.click()}
                          title={opt.imagePreview ? 'Replace image or GIF' : 'Add an image or GIF'}
                        >
                          {opt.imagePreview ? (
                            <img src={opt.imagePreview} alt="" />
                          ) : opt.linkMeta ? (
                            opt.linkMeta.imageUrl ? (
                              <img src={opt.linkMeta.imageUrl} alt="" />
                            ) : (
                              <PollInitialsBadge meta={opt.linkMeta} />
                            )
                          ) : (
                            '📷'
                          )}
                        </button>
                        <input
                          id={`poll-opt-file-${opt.key}`}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => handleImageChange(opt.key, e.target.files?.[0] ?? null)}
                        />
                        {opt.imagePreview && (
                          <button
                            type="button"
                            className="poll-opt-avatar-remove"
                            onClick={() => removeImage(opt.key)}
                            title="Remove image"
                            aria-label="Remove image"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      <input
                        type="text"
                        className="poll-opt-label-input"
                        value={opt.label}
                        onChange={(e) => updateOption(opt.key, { label: e.target.value })}
                        placeholder="Option label"
                      />
                      {options.length > 2 && (
                        <button type="button" className="poll-opt-remove" onClick={() => removeOption(opt.key)} aria-label="Remove option">
                          −
                        </button>
                      )}
                    </div>

                    <div className="poll-opt-link-row">
                      <div className="poll-opt-link-field">
                        <span className="poll-opt-link-icon" aria-hidden="true">
                          <LinkIcon />
                        </span>
                        <input
                          type="text"
                          className="poll-opt-link-input"
                          placeholder="Or paste a link — restaurant site, Google Maps…"
                          value={opt.linkUrl}
                          onChange={(e) => handleLinkChange(opt.key, e.target.value)}
                        />
                      </div>
                      <span className={`poll-opt-link-status${opt.linkMeta ? '' : ' bad'}`}>
                        {!opt.linkUrl ? '' : opt.linkChecking ? 'Checking…' : opt.linkMeta ? `✓ ${opt.linkMeta.host}` : "That doesn't look like a full link yet"}
                      </span>
                    </div>
                  </div>
                ))}
                {options.length < MAX_POLL_OPTIONS && (
                  <button type="button" className="poll-add-opt" onClick={addOption}>
                    + Add option
                  </button>
                )}
              </>
            )}

            <div className="field">
              <label>Poll closes in</label>
              {isEditMode ? (
                <p className="field-hint">Currently {formatCloseCountdown(currentClosesAt)}</p>
              ) : (
                <p className="field-hint">Voting stops automatically once this passes</p>
              )}
              <div className="radio-group">
                {DURATION_PRESETS.map(([ms, label]) => (
                  <button
                    key={ms}
                    type="button"
                    className={`radio-chip${(isEditMode ? selectedDurationMs : durationMs) === ms ? ' active' : ''}`}
                    onClick={() => (isEditMode ? setSelectedDurationMs(ms) : setDurationMs(ms))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Was create-mode only (!isEditMode) — these three carry no
                vote-integrity risk (see updatePoll's own comment), so
                there's no reason they were ever hidden after creation;
                that gap was the "poll edit isn't fully functional" bug.
                Always rendered now, seeded from the loaded poll in edit
                mode by the fetch effect above. */}
            <div className="toggle-group">
              <PollToggleRow
                id="allowMsg"
                label="Let voters attach a message"
                hint={'Short note next to their vote — "Team Girl! 💗" — shown under their alias, never their name.'}
                checked={allowMessages}
                onChange={setAllowMessages}
              />
              <div className="toggle-row">
                <div>
                  <div className="tlabel">Ask for a name before voting</div>
                  <div className="tsub">Stops repeat votes and lets you know who's who. Only you ever see it.</div>
                </div>
                <Switch.Root checked disabled nativeButton render={<button type="button" />} className="switch on" aria-label="Ask for a name before voting (always on)" />
              </div>
              <PollToggleRow
                id="suspenseMode"
                label="Hide results until you reveal them"
                hint="Guests watch votes roll in but can't see the breakdown — you trigger the reveal moment when everyone's ready."
                checked={suspenseMode}
                onChange={setSuspenseMode}
              />
              <PollToggleRow
                id="commentsLive"
                label="Show comments & activity live"
                hint="Guests watch the message wall fill up as people vote. Turn off to reveal it all at once when you close the poll."
                checked={commentsLive}
                onChange={setCommentsLive}
              />
            </div>

            <button className="primary-btn" style={{ marginTop: 22 }} onClick={handleSubmit} disabled={submitting}>
              {submitting ? (isEditMode ? 'Saving…' : 'Creating…') : isEditMode ? 'Save changes' : 'Create poll'}
            </button>
          </div>

          {/* Guest-facing mockup, not a results chart — no percentage bars
              or vote counts, since nobody's voted yet at create time (and
              in edit mode this just reflects whatever's currently in the
              form, same as create — no special-casing needed here). Own
              shell class (.poll-preview-card) rather than reusing
              .create-preview-card directly: same card-shell values
              (background/border/radius/padding/shadow) for visual
              consistency with Create.tsx, but its own inner structure
              (question + option rows) since a poll has no eyebrow/meta the
              way a gathering does. */}
          <div className="preview-wrap">
            <div className="poll-preview-card">
              <div className="poll-preview-question">{title || 'Your question'}</div>
              <div className="poll-preview-options">
                {previewOptions.map((opt) => (
                  <div className="poll-preview-option-row" key={opt.key}>
                    <span className="poll-preview-option-thumb">{optionBadgeContent(opt)}</span>
                    <span className="poll-preview-option-label">{opt.label.trim() || 'Option label'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PollToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div>
        <div className="tlabel" id={`${id}-label`}>{label}</div>
        <div className="tsub">{hint}</div>
      </div>
      <Switch.Root
        checked={checked}
        onCheckedChange={onChange}
        nativeButton
        render={<button type="button" />}
        className={(state) => `switch${state.checked ? ' on' : ''}`}
        aria-labelledby={`${id}-label`}
      />
    </div>
  );
}

// Plain inline SVG rather than a new icon-library dependency — the app
// doesn't already pull in one (icons elsewhere are either standalone
// files under /public/icons or, like this, hand-authored inline SVGs),
// so this matches the existing approach instead of introducing lucide or
// similar just for one glyph.
function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function PollInitialsBadge({ meta }: { meta: LinkMeta }) {
  const badge = initialsBadge(meta);
  return (
    <span className="poll-initials-badge" style={{ background: badge.bg, color: badge.fg }}>
      {badge.initials}
    </span>
  );
}

// Renders a *draft* option's thumbnail (local blob preview / not-yet-
// uploaded state, or edit mode's already-persisted image_url) — the live
// preview's and locked-options list's own parallel to PollOptionBadge,
// which renders a *persisted* AliasPollOption instead. Same
// image > link-preview > monogram priority as that component — no emoji
// fallback, so this always returns something to render.
function optionBadgeContent(opt: DraftOption) {
  if (opt.imagePreview) return <img src={opt.imagePreview} alt="" />;
  if (opt.linkMeta) return opt.linkMeta.imageUrl ? <img src={opt.linkMeta.imageUrl} alt="" /> : <PollInitialsBadge meta={opt.linkMeta} />;
  // Reuses .poll-initials-badge's existing full-fill centering (same class
  // PollInitialsBadge itself renders into) rather than a bare string, so
  // this draft preview actually matches PollOptionBadge's real black-bg/
  // white-text monogram once the option is persisted.
  return (
    <span className="poll-initials-badge" style={{ background: '#000', color: '#fff' }}>
      {optionMonogram(opt.label)}
    </span>
  );
}
