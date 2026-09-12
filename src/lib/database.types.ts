export type Category = 'hike_sports' | 'travel_holiday' | 'food' | 'music_art' | 'other';
export type Visibility = 'public' | 'private' | 'invited';
export type CostMode = 'split_pay' | 'get_tix';
// 'dutch': each guest types their own amount (Split Bill only) rather than
// Komon computing an equal share or the organizer setting one per person.
// 'custom' ("Set amount per person") is legacy — no longer offered in
// Create.tsx/Edit.tsx's split-method picker, kept here only because
// existing gatherings created with it still need to render correctly
// (SplitPayPanel.tsx still has a branch for it) and weren't migrated.
export type SplitMethod = 'equal' | 'custom' | 'itemized' | 'dutch';
export type PayMode = 'direct' | 'stripe';
export type PayMethod = 'venmo' | 'paypal' | 'cashapp' | 'monzo' | 'revolut';
// 'event': the full "New gathering" flow (RSVPs, guest list, poll, invites).
// 'split_bill': the lightweight quick-create flow — no RSVPs/names/guest
// list, just an amount and a payment link. Drives which panels Detail.tsx
// and FlyerCard.tsx render.
export type GatheringKind = 'event' | 'split_bill';

export interface Gathering {
  id: string;
  organizer_id: string;
  title: string;
  category: Category;
  gathering_date: string;
  gathering_time: string | null;
  location: string | null;
  capacity: number;
  cover_image_url: string | null;
  visibility: Visibility;
  cost_enabled: boolean;
  cost_mode: CostMode;
  cost_total: number;
  split_method: SplitMethod;
  pay_mode: PayMode;
  pay_method: PayMethod | null;
  pay_handle: string | null;
  stripe_account_id: string | null;
  poll_enabled: boolean;
  poll_question: string | null;
  reminder_on: boolean;
  created_at: string;
  /** Soft-cancel marker, organizer-only. Set when the organizer cancels the
   *  whole gathering; unlike an RSVP cancel, there's no un-cancel flow for
   *  this in v1. Every RSVP/cost_item/poll row underneath stays untouched —
   *  see the cancelled-state UI in Detail.tsx and getDeleteBlockReason() in
   *  src/data/gatherings.ts, which uses this to keep hard delete from
   *  destroying payment history. */
  cancelled_at: string | null;
  kind: GatheringKind;
}

export interface Rsvp {
  id: string;
  gathering_id: string;
  guest_user_id: string;
  name: string;
  phone: string | null;
  paid_sent: boolean;
  paid: boolean;
  created_at: string;
  /** Soft-cancel marker. Set when a guest cancels their own RSVP; cleared
   *  back to null if they RSVP again. paid_sent/paid are untouched by
   *  either transition — see activeRsvps() for where cancelled rows get
   *  filtered out of "who's in" / counts / the paid-progress ring. */
  cancelled_at: string | null;
  /** Split Bill ("dutch" split_method) only: what this guest typed as what
   *  they owe. Null for every other split_method — an equal-split guest's
   *  amount is always computed live from cost_total, never stored here. */
  amount_owed: number | null;
}

export interface CostItem {
  id: string;
  gathering_id: string;
  name: string;
  amount: number;
  position: number;
}

export interface PollOption {
  id: string;
  gathering_id: string;
  label: string;
  position: number;
}

export interface PollVote {
  id: string;
  poll_option_id: string;
  gathering_id: string;
  voter_user_id: string;
  created_at: string;
}

export interface InvitedEmail {
  id: string;
  gathering_id: string;
  email: string;
  accessed: boolean;
  created_at: string;
}

export interface GatheringWithRelations extends Gathering {
  rsvps: Rsvp[];
  cost_items: CostItem[];
  poll_options: (PollOption & { poll_votes: { id: string; voter_user_id: string }[] })[];
  invited_emails: InvitedEmail[];
}

// --- Alias Polls ------------------------------------------------------
// A second, unrelated poll concept: top-level (not nested under a
// gathering), voted on under a made-up alias with no account. See
// supabase/migrations/0010_alias_polls.sql — table names carry an
// alias_poll_ prefix specifically so they don't collide with
// PollOption/PollVote above, which are a different feature.

export type ChartStyle = 'card' | 'columns';
export type AliasPollStatus = 'open' | 'closed';

export interface LinkMeta {
  host: string;
  name: string;
  /** og:image URL from the server-side scrape (api/poll-link-preview.ts),
   *  captured once at option-creation time and reused directly on every
   *  render — never re-fetched per page view. Null when the scrape found
   *  no og:image, in which case the UI falls back to a colored-initials
   *  badge derived from host/name instead. */
  imageUrl: string | null;
}

export interface AliasPoll {
  id: string;
  organizer_user_id: string;
  title: string;
  chart_style: ChartStyle;
  suspense_mode: boolean;
  comments_live: boolean;
  allow_messages: boolean;
  /** Persists the organizer's "Reveal to guests" action — once true, every
   *  guest sees the full breakdown regardless of suspense_mode. */
  revealed: boolean;
  status: AliasPollStatus;
  created_at: string;
  closed_at: string | null;
  /** Round 5: every poll now has a close date/time, set at create time and
   *  editable afterward (see UpdatePollInput.closesAt). Null only on polls
   *  created before this field existed — treated as "never expires" for
   *  backward compatibility (see 0012_poll_close_date.sql). */
  closes_at: string | null;
}

export interface AliasPollOption {
  id: string;
  poll_id: string;
  label: string;
  position: number;
  emoji: string | null;
  image_url: string | null;
  link_url: string | null;
  link_meta: LinkMeta | null;
}

// Guest-facing shape — matches the alias_poll_votes_public view exactly,
// real_name structurally absent rather than just unrendered.
export interface AliasPollVotePublic {
  id: string;
  poll_id: string;
  option_id: string;
  alias: string;
  alias_avatar: string;
  message: string | null;
  created_at: string;
}

// Organizer-only shape — matches get_alias_poll_votes()'s return rows
// (setof alias_poll_votes, i.e. the whole base-table row). Also reused
// as-is for a guest's own vote (fetchMyVote), which reads the base table
// directly for exactly one row: their own, via alias_poll_votes_select_own
// (0013_alias_poll_votes_identity.sql) — same full shape either way.
export interface AliasPollVote extends AliasPollVotePublic {
  real_name: string;
  /** Null on votes cast before 0013_alias_poll_votes_identity.sql added
   *  this column — every vote cast from that migration on always sets it. */
  voter_user_id: string | null;
}
