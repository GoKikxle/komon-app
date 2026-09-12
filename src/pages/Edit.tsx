import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Switch } from '@base-ui/react/switch';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { CATS, fmtDate } from '../lib/constants';
import { BackLink } from '../components/BackLink';
import {
  createPollOptions,
  fetchGathering,
  replaceCostItems,
  syncInvitedEmails,
  updateGathering,
  uploadCoverImage,
} from '../data/gatherings';
import type { Category, GatheringWithRelations, PayMethod, SplitMethod, Visibility } from '../lib/database.types';

interface ItemRow {
  name: string;
  amount: string;
}

export function Edit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { userId, ready } = useAuth();
  const toast = useToast();

  const [gathering, setGathering] = useState<GatheringWithRelations | null>(null);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [cat, setCat] = useState<Category>('hike_sports');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('8');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);

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

  useEffect(() => {
    if (!id) return;
    fetchGathering(id)
      .then((g) => {
        if (!g) {
          setGathering(null);
          return;
        }
        setGathering(g);
        setTitle(g.title);
        setCat(g.category);
        setDate(g.gathering_date);
        setTime(g.gathering_time || '');
        setLocation(g.location || '');
        setCapacity(String(g.capacity));
        setImagePreview(g.cover_image_url);
        setVisibility(g.visibility);
        setEmails(g.invited_emails.map((e) => e.email));
        setCostEnabled(g.cost_enabled);
        // 'custom' ("Set amount per person") is no longer offered in the
        // radio group below, but a gathering created before its removal
        // can still have it here — seeding it as-is (rather than coercing
        // to 'equal') means re-saving without touching this field leaves
        // that bill's math untouched; no chip just shows as selected. See
        // the PR that removed the option for why existing 'custom' rows
        // aren't migrated.
        setCostMethod(g.split_method);
        setCostTotal(g.split_method === 'itemized' ? '' : String(g.cost_total || ''));
        setItems(g.cost_items.map((it) => ({ name: it.name, amount: String(it.amount) })));
        setPayMethod(g.pay_method || 'venmo');
        setPayHandle(g.pay_handle || '');
        setPollEnabled(g.poll_enabled);
        setPollQ(g.poll_question || '');
        if (g.poll_options.length === 0) {
          setOpt1('');
          setOpt2('');
          setOpt3('');
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const itemTotal = useMemo(() => items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0), [items]);
  const pollLocked = (gathering?.poll_options.length ?? 0) > 0;

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImageRemoved(false);
  }

  function removeImage() {
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(true);
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

  async function handleSubmit() {
    if (!gathering || !id) return;
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
      let coverImageUrl: string | null = gathering.cover_image_url;
      if (imageFile) {
        coverImageUrl = await uploadCoverImage(imageFile, userId);
      } else if (imageRemoved) {
        coverImageUrl = null;
      }

      const cleanItems = items
        .filter((it) => it.name || it.amount)
        .map((it) => ({ name: it.name || 'Item', amount: Number(it.amount) || 0 }));
      const finalTotal = costMethod === 'itemized' ? itemTotal : Number(costTotal) || 0;
      const cleanEmails = emails.map((e) => e.trim()).filter(Boolean);

      await updateGathering(id, {
        title,
        category: cat,
        date,
        time,
        location,
        capacity: Number(capacity) || 8,
        coverImageUrl,
        visibility,
        costEnabled,
        splitMethod: costMethod,
        costTotal: finalTotal,
        payMethod,
        payHandle,
        pollEnabled,
        pollQuestion: pollQ,
      });

      await replaceCostItems(id, costEnabled && costMethod === 'itemized' ? cleanItems : []);

      if (visibility === 'invited') {
        await syncInvitedEmails(id, cleanEmails, gathering.invited_emails);
      }

      if (!pollLocked && pollEnabled) {
        const pollOptions = [opt1, opt2, opt3].map((o) => o.trim()).filter(Boolean);
        if (pollOptions.length) await createPollOptions(id, pollOptions);
      }

      toast('Gathering updated');
      navigate(`/g/${id}`);
    } catch (err) {
      console.error(err);
      toast('Something went wrong saving your changes');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !ready) {
    return (
      <div className="wrap">
        <p className="lede">Loading…</p>
      </div>
    );
  }

  if (!gathering || !id) {
    return (
      <div className="wrap">
        <BackLink label="Board" onClick={() => navigate('/')} />
        <p className="lede">Gathering not found.</p>
      </div>
    );
  }

  if (gathering.organizer_id !== userId) {
    return (
      <div className="wrap">
        <BackLink label="Gathering" onClick={() => navigate(`/g/${id}`)} />
        <p className="lede">Only the organizer can edit this gathering.</p>
      </div>
    );
  }

  const c = CATS[cat];
  const dateStr = date ? fmtDate(date) : 'Pick a date';
  const locStr = location || 'Add a place';

  return (
    <div className="wrap">
      <BackLink label="Edit gathering" onClick={() => navigate(`/g/${id}`)} />
      <h1>Update the details</h1>
      <p className="lede">Changes save to the same link — guests who already have it will see the update.</p>

      <div className="create-layout">
        <div>
          <div className="field">
            <label>Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
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
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="field">
            <label>Capacity</label>
            <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>

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
                <input type="text" placeholder="e.g. sam-hikes" value={payHandle} onChange={(e) => setPayHandle(e.target.value)} />
              </div>
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
              {pollLocked ? (
                <div>
                  <p className="mode-note">
                    Options are locked once people start voting, so results stay meaningful. Turn the poll off if you
                    need a different question entirely.
                  </p>
                  <ul className="item-breakdown">
                    {gathering.poll_options.map((o) => (
                      <li key={o.id}>
                        <span>{o.label}</span>
                        <span>{o.poll_votes.length} votes</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}

          <button className="primary-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        <div className="preview-wrap">
          <div className="preview-flyer">
            <div className="stripe" />
            <div className="cat">{c.label}</div>
            <div className="title">{title || 'Your gathering title'}</div>
            <div className="meta">
              {dateStr}
              {time ? ` · ${time}` : ''}
              <br />
              {locStr}
            </div>
            {imagePreview && <div className="flyer-photo" style={{ backgroundImage: `url(${imagePreview})` }} />}
          </div>
        </div>
      </div>
    </div>
  );
}
