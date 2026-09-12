import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { activeRsvps, fetchGathering, splitBillProgress } from '../data/gatherings';
import type { GatheringWithRelations } from '../lib/database.types';
import { useAuth } from '../hooks/useAuth';
import { CATS, VIS, fmtDate } from '../lib/constants';
import { BackLink } from '../components/BackLink';
import { RsvpPanel } from '../components/detail/RsvpPanel';
import { SplitPayPanel } from '../components/detail/SplitPayPanel';
import { PollPanel } from '../components/detail/PollPanel';
import { InvitePanel } from '../components/detail/InvitePanel';
import { SharePanel } from '../components/detail/SharePanel';
import { InviteGate } from '../components/detail/InviteGate';
import { OrganizerPanel } from '../components/detail/OrganizerPanel';
import { CancelledPanel } from '../components/detail/CancelledPanel';
import { SplitBillPayPanel } from '../components/detail/SplitBillPayPanel';
import { SplitBillProgressPanel } from '../components/detail/SplitBillProgressPanel';

function gateKey(gatheringId: string) {
  return `komon-gate-${gatheringId}`;
}

export function Detail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const previewAsGuest = searchParams.get('preview') === 'guest';
  const { userId, ready, isPersistent } = useAuth();

  const [gathering, setGathering] = useState<GatheringWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [gateVerified, setGateVerified] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    fetchGathering(id)
      .then((data) => {
        setGathering(data);
        setGateVerified(Boolean(sessionStorage.getItem(gateKey(id))));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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

  const isOrganizer = gathering.organizer_id === userId;

  if (gathering.visibility === 'invited' && !gateVerified && (previewAsGuest || !isOrganizer)) {
    return (
      <InviteGate
        gathering={gathering}
        previewAsGuest={previewAsGuest}
        onVerified={() => {
          sessionStorage.setItem(gateKey(id), '1');
          setGateVerified(true);
          load();
        }}
      />
    );
  }

  const c = CATS[gathering.category];
  const v = VIS[gathering.visibility];
  const isCancelled = Boolean(gathering.cancelled_at);
  const isSplitBill = gathering.kind === 'split_bill';
  const going = activeRsvps(gathering);
  // Only an active RSVP counts as "mine" — a cancelled row for this user
  // still exists (for its payment history), but the UI should treat it the
  // same as never having RSVP'd, so upsertRsvp's un-cancel path can kick in.
  const myRsvp = going.find((r) => r.guest_user_id === userId);

  return (
    <div className="wrap">
      <div className="detail-top">
        <div>
          {/* Anonymous guests don't have a board — Home.tsx only renders
              one for signed-in sessions, so this is a no-op destination
              (Landing) for them and shouldn't be offered at all. Sits
              above the hero card, matching Figma's own left-column
              position (Frame 94: chevron-back + "Gathering"/"Split Bill"
              directly above the hero card, not spanning the full page). */}
          {isPersistent && (
            <BackLink
              label={isCancelled ? 'Closed' : isSplitBill ? 'Split bill' : 'Gathering'}
              onClick={() => navigate(isCancelled ? '/closed' : '/')}
            />
          )}
          <div className="hero-flyer">
            <div className="hero-flyer-body">
              <div className="cat">
                {isSplitBill ? 'Split bill' : c.label}
                <span className="hero-vis-badge">
                  <span className="hero-vis-dot" />
                  {v.label}
                </span>
                {isCancelled && <span className="hero-cancelled-badge">Cancelled</span>}
              </div>
              <div className="title">{gathering.title}</div>
              <div className="meta">
                <div className="meta-row">
                  {fmtDate(gathering.gathering_date)}
                  <span className="board-dot" />
                  {gathering.gathering_time || '—'}
                </div>
                <div className="meta-row">{gathering.location || 'TBD'}</div>
                <div className="meta-row">
                  {isSplitBill ? (
                    <>
                      £{splitBillProgress(gathering).collected.toFixed(2)} of £{splitBillProgress(gathering).target.toFixed(2)}{' '}
                      collected
                    </>
                  ) : (
                    <>
                      {going.length}/{gathering.capacity} going
                    </>
                  )}
                </div>
              </div>
            </div>
            {gathering.cover_image_url && (
              <div className="flyer-photo" style={{ backgroundImage: `url(${gathering.cover_image_url})` }} />
            )}
          </div>

          {isOrganizer && <SharePanel gathering={gathering} quickShare={isSplitBill} />}
        </div>

        <div>
          {/* Matches the left column's BackLink height exactly (64px row
              + 6px margin-bottom = 70px, measured live) so this column's
              first real card starts at the same y as the hero card
              instead of the grid's raw top — .detail-top's align-items:
              start means each column's own content just flows from its
              own top, and only the left column has anything there.
              Same isPersistent gate as BackLink itself: no spacer needed
              if that isn't rendering either. */}
          {isPersistent && <div style={{ height: 70 }} />}
          {isOrganizer && <OrganizerPanel gathering={gathering} onChange={load} />}

          {isCancelled ? (
            <CancelledPanel gathering={gathering} />
          ) : isSplitBill ? (
            isOrganizer ? (
              <SplitBillProgressPanel gathering={gathering} />
            ) : (
              userId && <SplitBillPayPanel gathering={gathering} userId={userId} myRsvp={myRsvp} onChange={load} />
            )
          ) : (
            <>
              {userId && (
                <RsvpPanel gathering={gathering} userId={userId} myRsvp={myRsvp} isOrganizer={isOrganizer} onChange={load} />
              )}

              {isOrganizer && gathering.visibility === 'invited' && (
                <InvitePanel gathering={gathering} onChange={load} onPreviewGuest={() => navigate(`/g/${id}?preview=guest`)} />
              )}

              {gathering.poll_enabled && userId && <PollPanel gathering={gathering} userId={userId} onChange={load} />}
            </>
          )}

          {!isSplitBill && gathering.cost_enabled && (
            <SplitPayPanel gathering={gathering} myRsvp={myRsvp} onChange={load} readOnly={isCancelled} isOrganizer={isOrganizer} />
          )}
        </div>
      </div>
    </div>
  );
}
