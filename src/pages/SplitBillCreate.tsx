import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { useDraft } from '../hooks/useDraft';
import { createSplitBill } from '../data/gatherings';
import type { PayMethod } from '../lib/database.types';
import { BackLink } from '../components/BackLink';

// Everything useDraft.ts (see that file) persists for this flow — every
// field here is a plain string/primitive already, no File/blob-URL issue
// the way Create.tsx's cover image has.
interface SplitBillDraft {
  step: number;
  label: string;
  totalAmount: string;
  dateMode: 'today' | 'custom';
  customDate: string;
  numberOfPeople: string;
  splitMethod: 'equal' | 'dutch';
  payMethod: PayMethod;
  payHandle: string;
}

const TOTAL_STEPS = 4;

// Quick-create flow, separate from the full "New gathering" form
// (Create.tsx). No cover photo, no category, no guest list — just enough
// to generate a payment link: amount, headcount, split rule, pay method.
// This page originated the .wizard-steps/.wizard-dot stepper pattern —
// Create.tsx now reuses these same classes for its own two-step flow.
export function SplitBillCreate() {
  const navigate = useNavigate();
  const { userId, ready, isPersistent } = useAuth();
  const toast = useToast();

  // Same gating pattern as Create.tsx: the primary entry points (Board/
  // Nav) won't navigate here until signed in, but this covers a direct
  // URL visit — redirects straight to /signin rather than showing an
  // in-between "Sign in to create" screen.
  useEffect(() => {
    if (ready && !isPersistent) navigate('/signin?next=/split/create', { replace: true });
  }, [ready, isPersistent, navigate]);

  const [step, setStep] = useState(1);
  const [label, setLabel] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [dateMode, setDateMode] = useState<'today' | 'custom'>('today');
  const [customDate, setCustomDate] = useState('');
  const [numberOfPeople, setNumberOfPeople] = useState('2');
  const [splitMethod, setSplitMethod] = useState<'equal' | 'dutch'>('equal');
  const [payMethod, setPayMethod] = useState<PayMethod>('venmo');
  const [payHandle, setPayHandle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { restored: draftRestored, markSubmitted: markDraftSubmitted, discard: discardDraft } = useDraft<SplitBillDraft>({
    key: userId ? `komon-draft-create-splitbill-${userId}` : '',
    enabled: Boolean(userId),
    value: { step, label, totalAmount, dateMode, customDate, numberOfPeople, splitMethod, payMethod, payHandle },
    onRestore: (d) => {
      setStep(d.step);
      setLabel(d.label);
      setTotalAmount(d.totalAmount);
      setDateMode(d.dateMode);
      setCustomDate(d.customDate);
      setNumberOfPeople(d.numberOfPeople);
      setSplitMethod(d.splitMethod);
      setPayMethod(d.payMethod);
      setPayHandle(d.payHandle);
    },
  });

  const amountNumber = Number(totalAmount) || 0;
  const peopleNumber = Number(numberOfPeople) || 0;
  const perPerson = peopleNumber > 0 ? amountNumber / peopleNumber : 0;
  const dateReady = dateMode === 'today' || Boolean(customDate);

  const canAdvance = (step === 1 && amountNumber > 0 && dateReady) || (step === 2 && peopleNumber > 0) || step === 3 || step === 4;

  function next() {
    if (!canAdvance) {
      if (step === 1) toast(amountNumber > 0 ? 'Pick a date' : 'Enter a total amount');
      else toast('Enter how many people are splitting');
      return;
    }
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }

  function back() {
    setStep((s) => Math.max(1, s - 1));
  }

  async function handleSubmit() {
    if (!userId) {
      toast('Still setting things up — try again in a moment');
      return;
    }
    setSubmitting(true);
    try {
      const id = await createSplitBill({
        organizerId: userId,
        title: label.trim() || undefined,
        date: dateMode === 'custom' ? customDate : undefined,
        totalAmount: amountNumber,
        numberOfPeople: peopleNumber,
        splitMethod,
        payMethod,
        payHandle,
      });
      markDraftSubmitted();
      navigate(`/created/${id}`);
    } catch (err) {
      console.error(err);
      toast('Something went wrong creating the split bill');
    } finally {
      setSubmitting(false);
    }
  }

  // Covers both "auth not resolved yet" and "resolved anonymous, the
  // effect above is about to navigate away".
  if (!ready || !isPersistent) {
    return (
      <div className="wrap">
        <p className="lede">Loading…</p>
      </div>
    );
  }

  return (
    <div className="split-page">
      <div className="wrap">
      <BackLink label="Split bill" onClick={() => navigate('/')} />
      <h1>Split a bill, fast</h1>
      <p className="lede">No guest list, no names — just an amount and a payment link.</p>

      <div className="wizard-steps">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
          <div key={n} className={`wizard-dot${n === step ? ' active' : n < step ? ' done' : ''}`} />
        ))}
      </div>

      {draftRestored && (
        <div className="draft-banner" style={{ maxWidth: 480 }}>
          <span>Continuing where you left off.</span>
          <button type="button" className="link-btn" onClick={discardDraft}>
            Start fresh instead
          </button>
        </div>
      )}

      <div className="panel" style={{ maxWidth: 480 }}>
        {step === 1 && (
          <>
            <h2>Total amount</h2>
            <div className="field">
              <label>Label</label>
              <input
                type="text"
                placeholder="What's this for? (optional)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Total cost (£)</label>
              <input
                type="number"
                placeholder="60"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="field">
              <label>Date</label>
              <div className="radio-group">
                <button
                  type="button"
                  className={`radio-chip${dateMode === 'today' ? ' active' : ''}`}
                  onClick={() => setDateMode('today')}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={`radio-chip${dateMode === 'custom' ? ' active' : ''}`}
                  onClick={() => setDateMode('custom')}
                >
                  Different date
                </button>
              </div>
              {dateMode === 'custom' && (
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  style={{ marginTop: 10 }}
                />
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Number of people splitting</h2>
            <div className="field">
              <label>How many people</label>
              <input
                type="number"
                min={1}
                value={numberOfPeople}
                onChange={(e) => setNumberOfPeople(e.target.value)}
                autoFocus
              />
            </div>
            {amountNumber > 0 && peopleNumber > 0 && <p className="poll-hint">Equal split: £{perPerson.toFixed(2)} each</p>}
          </>
        )}

        {step === 3 && (
          <>
            <h2>Split type</h2>
            <div className="mode-cards">
              <button
                type="button"
                className={`mode-card${splitMethod === 'equal' ? ' active' : ''}`}
                onClick={() => setSplitMethod('equal')}
              >
                <span className="mode-title">Equal</span>
                <span className="mode-sub">Komon splits it evenly — £{perPerson.toFixed(2)} each</span>
              </button>
              <button
                type="button"
                className={`mode-card${splitMethod === 'dutch' ? ' active' : ''}`}
                onClick={() => setSplitMethod('dutch')}
              >
                <span className="mode-title">Dutch</span>
                <span className="mode-sub">Everyone pays their own amount</span>
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2>How should people pay?</h2>
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
            <p className="mode-note">
              Komon doesn't hold or move money — it sends each guest to your payment link with the amount pre-filled,
              then tracks who's confirmed paying.
            </p>
            <p className="poll-hint" style={{ marginBottom: 0 }}>
              £{amountNumber.toFixed(2)} split {splitMethod === 'equal' ? 'equally' : 'Dutch'} among {peopleNumber} people.
            </p>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          {step > 1 && (
            <button className="btn-outline" onClick={back} disabled={submitting}>
              Back
            </button>
          )}
          {step < TOTAL_STEPS ? (
            <button className="primary-btn" style={{ width: 'auto', padding: '9px 20px' }} onClick={next} disabled={!canAdvance}>
              Next
            </button>
          ) : (
            <button
              className="primary-btn"
              style={{ width: 'auto', padding: '9px 20px' }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Creating…' : 'Create & share'}
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
