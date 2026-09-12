import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Switch } from '@base-ui/react/switch';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { CATS, fmtDate } from '../lib/constants';
import { createGathering, uploadCoverImage } from '../data/gatherings';
import type { Category, PayMethod, SplitMethod, Visibility } from '../lib/database.types';
import { BackLink } from '../components/BackLink';

interface ItemRow {
  name: string;
  amount: string;
}

const TOTAL_STEPS = 2;

export function Create() {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const [searchParams] = useSearchParams();
  const { userId, ready, isPersistent } = useAuth();
  const toast = useToast();

  // Primary entry is gated upstream (Board/Nav's "+ New gathering" won't
  // navigate here until signed in), but this covers a direct URL visit —
  // the form itself must never render for an anonymous session. Redirects
  // straight to /signin rather than showing an in-between "Sign in to
  // create" screen — no reason to make someone click twice. Preserves the
  // current query string (not just the bare path) so an anonymous visit to
  // /create?fromPoll=... (Alias Polls' "Start a gathering" CTA) still
  // resumes with that prefill intact after signing in.
  useEffect(() => {
    if (ready && !isPersistent) navigate(`/signin?next=${encodeURIComponent(routerLocation.pathname + routerLocation.search)}`, { replace: true });
  }, [ready, isPersistent, routerLocation, navigate]);

  const [step, setStep] = useState(1);
  // Alias Polls' "Start a gathering" CTA (src/pages/PollOrganize.tsx) links
  // here as /create?fromPoll=<id>&title=<question> — title-prefill only,
  // per the flagged v1 decision (no auto-invite, no contact field collected
  // at vote time). Read once on mount; nothing else about this form changes.
  const [title, setTitle] = useState(() => searchParams.get('title') || '');
  const [cat, setCat] = useState<Category>('hike_sports');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('8');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [visibility, setVisibility] = useState<Visibility>('private');
  const [emails, setEmails] = useState<string[]>([]);

  const [costEnabled, setCostEnabled] = useState(false);
  const [costMethod, setCostMethod] = useState<SplitMethod>('equal');
  const [costTotal, setCostTotal] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [payMethod, setPayMethod] = useState<PayMethod>('venmo');
  const [payHandle, setPayHandle] = useState('');

  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQ, setPollQ] = useState('');
  const [opt1, setOpt1] = useState('');
  const [opt2, setOpt2] = useState('');
  const [opt3, setOpt3] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const itemTotal = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0),
    [items]
  );

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function removeImage() {
    setImageFile(null);
    setImagePreview(null);
  }

  function updateItem(i: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateEmail(i: number, value: string) {
    setEmails((prev) => prev.map((e, idx) => (idx === i ? value : e)));
  }

  function removeEmail(i: number) {
    setEmails((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Same validation handleSubmit already requires (title + date) — step 1
  // covers both, so gating "Next" on them here just surfaces the problem
  // a step earlier instead of only at final submit.
  function next() {
    if (!title || !date) {
      toast(!title ? 'Add a title' : 'Pick a date');
      return;
    }
    setStep(2);
  }

  function back() {
    setStep(1);
  }

  async function handleSubmit() {
    if (!title || !date) {
      toast('Add at least a title and date');
      return;
    }
    if (!userId) {
      toast('Still setting things up — try again in a moment');
      return;
    }

    setSubmitting(true);
    try {
      let coverImageUrl: string | null = null;
      if (imageFile) {
        coverImageUrl = await uploadCoverImage(imageFile, userId);
      }

      const cleanItems = items
        .filter((it) => it.name || it.amount)
        .map((it) => ({ name: it.name || 'Item', amount: Number(it.amount) || 0 }));
      const finalTotal = costMethod === 'itemized' ? itemTotal : Number(costTotal) || 0;
      const cleanEmails = emails.map((e) => e.trim()).filter(Boolean);
      const pollOptions = [opt1, opt2, opt3].map((o) => o.trim()).filter(Boolean);

      const id = await createGathering({
        organizerId: userId,
        title,
        category: cat,
        date,
        time,
        location,
        capacity: Number(capacity) || 8,
        coverImageUrl,
        visibility,
        invitedEmails: cleanEmails,
        costEnabled,
        splitMethod: costMethod,
        costTotal: finalTotal,
        items: cleanItems,
        payMethod,
        payHandle,
        pollEnabled,
        pollQuestion: pollQ,
        pollOptions,
      });

      navigate(`/created/${id}`);
    } catch (err) {
      console.error(err);
      toast('Something went wrong creating the gathering');
    } finally {
      setSubmitting(false);
    }
  }

  // Covers both "auth not resolved yet" and "resolved anonymous, the
  // effect above is about to navigate away" — the form itself must never
  // render for an anonymous session, and there's nothing worth showing
  // in between besides a loading state.
  if (!ready || !isPersistent) {
    return (
      <div className="wrap">
        <p className="lede">Loading…</p>
      </div>
    );
  }

  const c = CATS[cat];
  const dateStr = date ? fmtDate(date) : 'Pick a date';
  const locStr = location || 'Add a place';

  return (
    <div className="create-page">
      <div className="wrap">
      <div className="create-layout">
        <div>
          {/* Header block moved inside the grid's first column so
              .create-layout's row 1 starts at the eyebrow row's top, not
              at the Title field's top — Figma's frame has the header
              block (Frame 3034) and the preview card (Frame 1618868764)
              both starting at the same y (114), confirmed via
              get_metadata, so the card needs to top-align with the
              eyebrow row itself, not the form fields below it. */}
          <BackLink label="New gathering" onClick={() => navigate('/')} />
          <h1>Pin up the details</h1>
          <p className="lede">
            Fill this in once. Everything on the right updates live — that's the flyer people will actually see.
          </p>

          {/* Same two-step wizard pattern as SplitBillCreate.tsx —
              .wizard-steps/.wizard-dot reused verbatim (no separate
              stepper component exists there to import; it's inline
              markup on that page too). Dots stay visible across both
              steps, matching that page's own placement: above the step
              content, below the page header. */}
          <div className="wizard-steps">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
              <div key={n} className={`wizard-dot${n === step ? ' active' : n < step ? ' done' : ''}`} />
            ))}
          </div>

          {step === 1 && (
            <>
              <div className="field">
                <label>Title</label>
                <input
                  type="text"
                  placeholder="e.g. Ridge Line Sunrise Hike"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Cover image</label>
                <div className={`image-picker${imagePreview ? ' filled' : ''}`}>
                  {imagePreview ? (
                    <>
                      <img className="image-preview" src={imagePreview} alt="" />
                      <div className="image-actions">
                        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                          Cover set
                        </span>
                        <button type="button" onClick={removeImage}>
                          Remove
                        </button>
                      </div>
                    </>
                  ) : (
                    <label className="image-picker-label">
                      Tap to add a photo (optional)
                      <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>
              </div>

              <div className="field">
                <label>Category</label>
                <div className="cats">
                  {(Object.entries(CATS) as [Category, typeof CATS[Category]][])
                    .filter(([key]) => key !== 'other')
                    .map(([key, catDef]) => (
                      <button
                        key={key}
                        type="button"
                        className={`cat-chip${cat === key ? ' active' : ''}`}
                        onClick={() => setCat(key)}
                      >
                        {catDef.label}
                      </button>
                    ))}
                </div>
              </div>

              <div className="row2">
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>Time</label>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Location</label>
                <input
                  type="text"
                  placeholder="Where you're meeting"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Capacity</label>
                <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </div>

              <button type="button" className="primary-btn" onClick={next}>
                Next
              </button>
            </>
          )}
        </div>

        {/* Preview card sits between the "core" fields above
            (Title/Cover image/Category/Date/Time/Location — the only
            fields that actually feed the live preview) and the "rest" of
            the form below (Capacity/access/split/poll — none of which
            the preview reflects). On desktop's 2-column grid this has no
            visual effect: default grid auto-placement fills row 1 (core,
            then preview) before wrapping "rest" to row 2 col 1, identical
            to the previous 2-child layout. On the <=760px single-column
            breakpoint, the same auto-placement stacks the preview right
            after the fields that determine what it shows, instead of
            after every optional field (Capacity/access/split-a-cost/
            poll) — which is where it landed before, sometimes dozens of
            scroll-lengths down once those optional sections were
            expanded. .preview-wrap (sticky positioning only, no visual
            styling of its own) stays shared with Edit.tsx's identical
            preview. The card itself is Create-only — see
            .create-preview-* in index.css, deliberately not reusing
            .preview-flyer since Edit.tsx also depends on that and has no
            Figma spec of its own here. */}
        <div className="preview-wrap">
          <div className="create-preview-card">
            {imagePreview && <img className="create-preview-image" src={imagePreview} alt="" />}
            <div className="create-preview-body">
              <div className="create-preview-eyebrow">{c.label}</div>
              <div className="create-preview-title">{title || 'Your gathering title'}</div>
              <div className="create-preview-meta">
                <div className="create-preview-meta-row">
                  {dateStr}
                  {time && (
                    <>
                      <span className="board-dot" />
                      {time}
                    </>
                  )}
                </div>
                <div className="create-preview-meta-row">{locStr}</div>
              </div>
            </div>
          </div>
        </div>

        <div>
          {step === 2 && (
            <>
              <div className="field">
                <label>Who can access this?</label>
                <div className="mode-cards">
                  {(
                    [
                      ['public', 'Public', 'Anyone can find and access it'],
                      ['private', 'Private', 'Only people you share the link with'],
                      ['invited', 'Invited', 'Only the email addresses you add'],
                    ] as [Visibility, string, string][]
                  ).map(([key, label, sub]) => (
                    <button
                      key={key}
                      type="button"
                      className={`mode-card${visibility === key ? ' active' : ''}`}
                      onClick={() => setVisibility(key)}
                    >
                      <span className="mode-title">{label}</span>
                      <span className="mode-sub">{sub}</span>
                    </button>
                  ))}
                </div>
                {visibility === 'invited' && (
                  <div>
                    <label>Invited emails</label>
                    <div>
                      {emails.map((email, i) => (
                        <div className="email-row" key={i}>
                          <input
                            type="text"
                            placeholder="name@example.com"
                            value={email}
                            onChange={(e) => updateEmail(i, e.target.value)}
                          />
                          <button type="button" className="item-remove" aria-label="Remove email" onClick={() => removeEmail(i)}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="btn-outline" onClick={() => setEmails((p) => [...p, ''])}>
                      + Add email
                    </button>
                  </div>
                )}
              </div>

              <div className="toggle-row">
                <div>
                  <div className="tlabel" id="cost-toggle-label">Split a cost</div>
                  <div className="tsub">Everyone pays their share, one tap</div>
                </div>
                <Switch.Root
                  checked={costEnabled}
                  onCheckedChange={setCostEnabled}
                  nativeButton
                  render={<button type="button" />}
                  className={(state) => `switch${state.checked ? ' on' : ''}`}
                  aria-labelledby="cost-toggle-label"
                />
              </div>
              {costEnabled && (
                <div className="subfields">
                  <label>Split method</label>
                  <div className="radio-group">
                    {(
                      [
                        ['equal', 'Equal split'],
                        ['itemized', 'Itemized'],
                      ] as [SplitMethod, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`radio-chip${costMethod === key ? ' active' : ''}`}
                        onClick={() => setCostMethod(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {costMethod !== 'itemized' ? (
                    <div className="field">
                      <label>Total cost (£)</label>
                      <input type="number" placeholder="60" value={costTotal} onChange={(e) => setCostTotal(e.target.value)} />
                    </div>
                  ) : (
                    <div>
                      <label>Cost items</label>
                      <div>
                        {items.map((item, i) => (
                          <div className="item-row" key={i}>
                            <input
                              type="text"
                              className="iname"
                              placeholder="e.g. Entrance fee"
                              value={item.name}
                              onChange={(e) => updateItem(i, { name: e.target.value })}
                            />
                            <input
                              type="number"
                              className="iamt"
                              placeholder="0.00"
                              value={item.amount}
                              onChange={(e) => updateItem(i, { amount: e.target.value })}
                            />
                            <button type="button" className="item-remove" aria-label="Remove item" onClick={() => removeItem(i)}>
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      <button type="button" className="btn-outline" onClick={() => setItems((p) => [...p, { name: '', amount: '' }])}>
                        + Add item
                      </button>
                      <div className="item-total">Total: £{itemTotal.toFixed(2)}</div>
                    </div>
                  )}

                  <label style={{ marginTop: 12 }}>How should people pay?</label>
                  <div className="radio-group">
                    {(
                      [
                        ['venmo', 'Venmo'],
                        ['paypal', 'PayPal'],
                        ['cashapp', 'Cash App'],
                        ['monzo', 'Monzo'],
                        ['revolut', 'Revolut'],
                      ] as [PayMethod, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`radio-chip${payMethod === key ? ' active' : ''}`}
                        onClick={() => setPayMethod(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="field">
                    <label>Your @handle</label>
                    <input
                      type="text"
                      placeholder="e.g. sam-hikes"
                      value={payHandle}
                      onChange={(e) => setPayHandle(e.target.value)}
                    />
                  </div>
                  <p className="mode-note">
                    Komon doesn't hold or move money — it sends each guest to your payment link with the amount pre-filled,
                    then tracks who's confirmed paying. ("Pay through Komon" via Stripe is coming in a later pass.)
                  </p>
                </div>
              )}

              <div className="toggle-row">
                <div>
                  <div className="tlabel" id="poll-toggle-label">Add a poll</div>
                  <div className="tsub">Let the group decide something</div>
                </div>
                <Switch.Root
                  checked={pollEnabled}
                  onCheckedChange={setPollEnabled}
                  nativeButton
                  render={<button type="button" />}
                  className={(state) => `switch${state.checked ? ' on' : ''}`}
                  aria-labelledby="poll-toggle-label"
                />
              </div>
              {pollEnabled && (
                <div className="subfields">
                  <div className="field">
                    <label>Question</label>
                    <input type="text" placeholder="Which trailhead?" value={pollQ} onChange={(e) => setPollQ(e.target.value)} />
                  </div>
                  <div className="field opt-input">
                    <label>Option A</label>
                    <input type="text" placeholder="North ridge" value={opt1} onChange={(e) => setOpt1(e.target.value)} />
                  </div>
                  <div className="field opt-input">
                    <label>Option B</label>
                    <input type="text" placeholder="Riverside path" value={opt2} onChange={(e) => setOpt2(e.target.value)} />
                  </div>
                  <div className="field opt-input">
                    <label>Option C (optional)</label>
                    <input type="text" placeholder="" value={opt3} onChange={(e) => setOpt3(e.target.value)} />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-outline" onClick={back} disabled={submitting}>
                  Back
                </button>
                <button
                  className="primary-btn"
                  style={{ width: 'auto', padding: '9px 20px' }}
                  onClick={handleSubmit}
                  disabled={submitting || !ready}
                >
                  {submitting ? 'Creating…' : 'Create gathering'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
