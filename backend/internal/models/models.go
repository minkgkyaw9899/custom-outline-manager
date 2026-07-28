// Package models defines the domain types shared across the repository,
// enforcement, and HTTP layers.
package models

import (
	"fmt"
	"math"
	"net/url"
	"time"
)

// BytesPerGB is the conversion used everywhere a user-facing "GB" is turned
// into a byte ceiling. Decimal GB (1e9), matching how Outline Manager and
// most hosting quotas present data allowances.
const BytesPerGB = 1_000_000_000

// Every key is sold as at least one month's plan, so a key is never created or
// renewed with less than this. A create or renew that asks for nothing gets
// exactly one plan period; asking for less than one is a validation error
// rather than a silent upgrade, so a mistyped request is visible.
const (
	MinPlanGB   = 200.0
	MinPlanDays = 30
)

// BandwidthDisableMarginBytes is how far under a server's monthly bandwidth
// cap the kill switch trips — a safety margin against the hosting bill
// itself, not the cap number the admin entered.
const BandwidthDisableMarginBytes = 2 * BytesPerGB

// StartOfMonth truncates to midnight on the 1st of t's calendar month, in t's
// own location — the boundary a server's monthly bandwidth cap resets on.
func StartOfMonth(t time.Time) time.Time {
	y, m, _ := t.Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, t.Location())
}

// SameMonth reports whether a and b fall in the same calendar month and
// year, in a's location.
func SameMonth(a, b time.Time) bool {
	ay, am, _ := a.Date()
	by, bm, _ := b.In(a.Location()).Date()
	return ay == by && am == bm
}

type Server struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	APIURL          string     `json:"apiUrl"`
	CertSHA256      string     `json:"certSha256"`
	CostUSDPerMonth *float64   `json:"costUsdPerMonth"`
	LastSyncedAt    *time.Time `json:"lastSyncedAt"`
	LastSyncError   *string    `json:"lastSyncError"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`

	// MaxKeys caps how many keys may be created on this server. Nil means no
	// ceiling. Enforced when a key is created, never retroactively: lowering
	// it below the current count blocks new keys rather than deleting any.
	MaxKeys *int `json:"maxKeys"`

	// DefaultLimitBytes is the quota a new key on this server starts on, and
	// the ceiling applied to already-unlimited keys when the admin sets it.
	// Nil means no server-wide default.
	DefaultLimitBytes *int64 `json:"defaultLimitBytes"`

	// DefaultPriceMmk is what a new key on this server is sold for, in MMK,
	// unless overridden per key (see Key.PriceMmk). Nil means no default —
	// new keys start unpriced rather than assumed free.
	DefaultPriceMmk *int64 `json:"defaultPriceMmk"`

	// BandwidthLimitBytes is a monthly transfer cap (inbound + outbound),
	// independent of any key's own data limit — this is about the hosting
	// bill, not what any one holder is allowed to use. Nil means untracked.
	BandwidthLimitBytes *int64 `json:"bandwidthLimitBytes"`
	// BandwidthDisabledAt is set when the cron trips the cap; every key on
	// the server is forced to a 0-byte Outline limit until an admin manually
	// clears it (POST /servers/:id/bandwidth/enable). Nil = not tripped.
	BandwidthDisabledAt *time.Time `json:"bandwidthDisabledAt"`
	// BandwidthReenabledAt is when that override last happened, so the cron
	// doesn't immediately re-trip the same server in the same calendar month.
	BandwidthReenabledAt *time.Time `json:"-"`
}

// Hostname is the API URL's host without the port, used as the server's
// display subtitle. Outline reports no region/location for the server itself
// (the ASN `location` field describes clients), so the hostname is the most
// specific place identifier available.
func (s Server) Hostname() string {
	u, err := url.Parse(s.APIURL)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// ServerHealth is the traffic-light state shown on the servers list and the
// Overview's fleet health panel.
type ServerHealth string

const (
	// HealthHealthy: last sync succeeded.
	HealthHealthy ServerHealth = "healthy"
	// HealthDegraded: reachable, but its live metrics could not be read.
	HealthDegraded ServerHealth = "degraded"
	// HealthOffline: the last sync attempt failed, or it has never synced.
	HealthOffline ServerHealth = "offline"
)

// ASUsage is one autonomous system's share of a server's traffic — what the
// Outline Manager calls "ASes with most bandwidth usage". This replaces the
// mobile-carrier breakdown the design originally called for: Outline reports
// the AS org directly, so no admin-entered carrier field is needed.
type ASUsage struct {
	ASN              int     `json:"asn"`
	ASOrg            string  `json:"asOrg"`
	CountryCode      string  `json:"countryCode"`
	BytesTransferred int64   `json:"bytesTransferred"`
	TunnelTimeHours  float64 `json:"tunnelTimeHours"`
	SharePct         float64 `json:"sharePct"`
}

// ServerMetrics is the live view of one Outline server over MetricsWindow.
//
// Note there is no inbound/outbound split: Outline exposes a single transfer
// total. The UI shows CurrentBandwidthBps ("current bandwidth usage") and
// TotalBytes ("total bandwidth usage") in the two slots a directional split
// would otherwise occupy.
type ServerMetrics struct {
	Window              string     `json:"window"`
	TotalBytes          int64      `json:"totalBytes"`
	CurrentBandwidthBps int64      `json:"currentBandwidthBps"`
	PeakBandwidthBps    int64      `json:"peakBandwidthBps"`
	PeakBandwidthAt     *time.Time `json:"peakBandwidthAt"`
	TunnelTimeHours     float64    `json:"tunnelTimeHours"`
	ASes                []ASUsage  `json:"ases"`

	// PeakDevicesTotal sums each key's peak concurrent device count over the
	// window. Note this is an upper bound on simultaneous devices, not a true
	// fleet-wide concurrent peak: each key's peak may have occurred at a
	// different moment, and Outline reports no server-wide device figure.
	PeakDevicesTotal int `json:"peakDevicesTotal"`

	// OnlineKeys is how many keys moved traffic within OnlineWindow, i.e. how
	// many are connected right now. Unlike PeakDevicesTotal this is a snapshot,
	// so it does not depend on the metrics window.
	OnlineKeys int `json:"onlineKeys"`
}

// DailyUsage is one bucket's measured traffic for a server or key, derived
// from our own usage_snapshots history (Outline itself returns no time
// series). Date is a plain "2006-01-02" day for most callers, but is an
// RFC3339 timestamp when it comes from an hour-bucketed query (see
// Repository.HourlyUsageByKey) — callers that can receive either check the
// series' granularity rather than Date's format.
type DailyUsage struct {
	Date  string `json:"date"`
	Bytes int64  `json:"bytes"`
}

// RevenuePoint is one day's revenue/cost snapshot for a server — a level, not
// a delta, so unlike DailyUsage a series of these is never summed, only
// plotted or resampled to a coarser period by taking the latest of each.
type RevenuePoint struct {
	Date               string   `json:"date"`
	RevenueMmk         int64    `json:"revenueMmk"`
	CostUsdPerMonth    *float64 `json:"costUsdPerMonth"`
	ActiveKeys         int      `json:"activeKeys"`
	UnpricedActiveKeys int      `json:"unpricedActiveKeys"`
}

// ServerWithUsage is a Server plus rolled-up numbers for dashboard/list views.
// Metrics is nil when the server could not be reached for a live read — the
// row still renders, just without its live numbers.
type ServerWithUsage struct {
	Server
	Hostname       string       `json:"hostname"`
	Health         ServerHealth `json:"health"`
	KeyCount       int          `json:"keyCount"`
	ActiveKeys     int          `json:"activeKeys"`
	TotalUsedBytes int64        `json:"totalUsedBytes"`
	// MonthlyRevenueMmk sums each active key's effective price (its own
	// PriceMmk, falling back to the server's DefaultPriceMmk, else 0) — see
	// repository.ListServers. Computed server-side so the Revenue page and
	// any future consumer agree on one number rather than each re-deriving it.
	MonthlyRevenueMmk int64 `json:"monthlyRevenueMmk"`
	// UnpricedActiveKeys counts active keys with neither their own price nor
	// a server default to fall back to — a caveat that MonthlyRevenueMmk may
	// understate actual revenue, surfaced on the Revenue page.
	UnpricedActiveKeys int `json:"unpricedActiveKeys"`
	// FreeActiveKeys counts active keys whose effective price (their own, or
	// the server's default) is explicitly 0 — deliberately free, not simply
	// unpriced. MonthlyRevenueMmk already excludes them; this is what lets
	// the Revenue page show *why* a server's total is less than
	// activeKeys × price, e.g. 7 keys at 10,000 MMK but 1 free means only 6
	// are actually paying.
	FreeActiveKeys int            `json:"freeActiveKeys"`
	Metrics        *ServerMetrics `json:"metrics"`
	// DailySeries is the card's sparkline. It comes from our snapshot history,
	// so it only covers days since the server was added and is empty for a
	// freshly-registered server.
	DailySeries []DailyUsage `json:"dailySeries"`
	// RevenueDailySeries is the same idea for revenue/cost — snapshotted once
	// per cron tick starting from whenever this field shipped, so it is empty
	// or thin for a while before a real trend appears.
	RevenueDailySeries []RevenuePoint `json:"revenueDailySeries"`
	// BandwidthUsedBytesThisMonth is transfer since the start of the current
	// calendar month, measured the same way as the usage snapshots (derived
	// from Outline's cumulative counters, not a live probe) — compared
	// against BandwidthLimitBytes to decide whether the kill switch trips.
	BandwidthUsedBytesThisMonth int64 `json:"bandwidthUsedBytesThisMonth"`
}

// KeyMetrics is the per-key slice of a server's live metrics, keyed by the
// Outline access-key id.
type KeyMetrics struct {
	BytesTransferred int64      `json:"bytesTransferred"`
	TunnelTimeHours  float64    `json:"tunnelTimeHours"`
	LastTrafficSeen  *time.Time `json:"lastTrafficSeen"`
	PeakDeviceCount  int        `json:"peakDeviceCount"`

	// IsOnline is LastTrafficSeen falling inside OnlineWindow — the VPN is in
	// use right now. Derived server-side so every client agrees on the cutoff
	// and on which clock it is measured against.
	IsOnline bool `json:"isOnline"`
}

type KeyStatus string

const (
	StatusActive        KeyStatus = "active"
	StatusExpired       KeyStatus = "expired"
	StatusLimitExceeded KeyStatus = "limit_exceeded"
	StatusDisabled      KeyStatus = "disabled"
)

type Key struct {
	ID               string     `json:"id"`
	ServerID         string     `json:"serverId"`
	OutlineKeyID     string     `json:"outlineKeyId"`
	Name             string     `json:"name"`
	AccessURL        string     `json:"accessUrl"`
	Port             *int       `json:"port"`
	Method           *string    `json:"method"`
	UsedBytes        int64      `json:"usedBytes"`
	CustomLimitBytes *int64     `json:"customLimitBytes"`
	EndDate          *time.Time `json:"endDate"`
	// PriceMmk is what this key is actually sold for, in MMK. Nil means no
	// price has been set (falls back to the server's DefaultPriceMmk for
	// revenue purposes); 0 means explicitly free. See migration 0010.
	PriceMmk  *int64    `json:"priceMmk"`
	Enabled   bool      `json:"enabled"`
	Status    KeyStatus `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	// Password is the plaintext Shadowsocks password Outline issued for this
	// key (accessUrl carries it too, but base64-encoded together with the
	// method). Never serialized directly — it only ever leaves the API inside
	// DynamicAccessURL, or via the dedicated /dkey/:token endpoint.
	Password string `json:"-"`
	// DynamicToken is the opaque, unguessable id used in the key's ssconf://
	// dynamic access key link (GET /api/v1/dkey/:token). Stable for the life
	// of the key, independent of its internal id.
	DynamicToken string `json:"-"`

	// UserID is the person this key belongs to, nil for a key that has not
	// been assigned to one — every key adopted from an Outline server starts
	// that way, since Outline has no concept of a user.
	UserID *string `json:"userId"`

	// Computed, not persisted directly (status/enabled are persisted caches
	// but recomputed live wherever the key is read).
	DaysLeft       *int64 `json:"daysLeft"`
	RemainingBytes *int64 `json:"remainingBytes"`
	ServerName     string `json:"serverName,omitempty"`
	UserName       string `json:"userName,omitempty"`

	// DynamicAccessURL is the ssconf:// link to hand out instead of the
	// static ss:// accessUrl (see DynamicAccessURL below). Populated by the
	// handler layer, which is the only place that knows the server's public
	// base URL; empty when PUBLIC_BASE_URL is not configured.
	DynamicAccessURL string `json:"dynamicAccessUrl"`
}

// Enrich fills in the computed fields (status, daysLeft, remainingBytes) from
// the persisted ones. Every API response goes through this so clients never
// see a stale cached status.
func (k Key) Enrich(now time.Time) Key {
	status, daysLeft, remainingBytes, _ := DeriveKeyStatus(now, k.EndDate, k.CustomLimitBytes, k.UsedBytes, k.Enabled)
	k.Status = status
	k.DaysLeft = daysLeft
	k.RemainingBytes = remainingBytes
	return k
}

// EnrichKeys applies Enrich to a slice, returning a non-nil slice so the JSON
// encoding is always `[]` rather than `null` for an empty result.
func EnrichKeys(now time.Time, keys []Key) []Key {
	out := make([]Key, 0, len(keys))
	for _, k := range keys {
		out = append(out, k.Enrich(now))
	}
	return out
}

// DynamicAccessURL builds the ssconf:// link for a key's dynamic access
// token — see https://developer.getoutline.org/vpn/management/dynamic-access-keys.
// A dynamic key resolves through an HTTPS GET (the client replaces the
// ssconf:// scheme with https://) to the key's live connection info, so
// sharing this instead of the static ss:// link lets an admin move, rotate,
// or (via the existing enforcement reconciler) disable a key without ever
// having to redistribute a new link.
//
// baseURL is the server's own public host[:port] (config.PublicBaseURL, no
// scheme); an empty baseURL or token means the feature isn't configured for
// this deployment, in which case this returns "" and callers fall back to
// the static link. The name is carried in the URL fragment, matching the
// ss://...#name convention used for static links.
func DynamicAccessURL(baseURL, token, name string) string {
	if baseURL == "" || token == "" {
		return ""
	}
	return fmt.Sprintf("ssconf://%s/api/v1/dkey/%s#%s", baseURL, token, url.PathEscape(name))
}

// AccessKeyHostname reads the host Outline is currently stamping into a
// key's static ss:// link — i.e. whatever "hostname for access keys" is set
// to on the Outline server itself. Every key on a server shares this host,
// so the first key found is representative of all of them. Returns "" when
// there is no key to read it from, or the URL doesn't parse.
func AccessKeyHostname(accessURL string) string {
	u, err := url.Parse(accessURL)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

type RenewalLog struct {
	ID            string     `json:"id"`
	KeyID         string     `json:"keyId"`
	AddedGB       float64    `json:"addedGb"`
	AddedDays     int        `json:"addedDays"`
	NewLimitBytes *int64     `json:"newLimitBytes"`
	NewEndDate    *time.Time `json:"newEndDate"`
	CreatedAt     time.Time  `json:"createdAt"`
}

type UsageSnapshot struct {
	ID         int64     `json:"id"`
	ServerID   string    `json:"serverId"`
	KeyID      *string   `json:"keyId"`
	BytesTotal int64     `json:"bytesTotal"`
	RecordedAt time.Time `json:"recordedAt"`
}

// DeriveKeyStatus computes the live status/derived fields for a key and
// reports whether Outline access *should* currently be enabled. This is the
// single source of truth for "what should this key's state be", used both
// when serializing keys for the API and when the enforcement reconciler
// decides whether to push a change to the Outline server.
func DeriveKeyStatus(now time.Time, endDate *time.Time, customLimitBytes *int64, usedBytes int64, dbEnabled bool) (status KeyStatus, daysLeft *int64, remainingBytes *int64, shouldBeEnabled bool) {
	overDate := endDate != nil && now.After(*endDate)
	overQuota := customLimitBytes != nil && usedBytes >= *customLimitBytes

	shouldBeEnabled = !overDate && !overQuota

	switch {
	case overDate:
		status = StatusExpired
	case overQuota:
		status = StatusLimitExceeded
	case !dbEnabled:
		// Not over date/quota, yet still marked disabled in DB: reconcile
		// hasn't caught up yet (or a future manual-disable feature set this).
		status = StatusDisabled
	default:
		status = StatusActive
	}

	if endDate != nil {
		// Round up: any part of a day still remaining counts as a day left, so
		// a key expiring in six hours reads as "1 day", not "0".
		d := int64(math.Ceil(endDate.Sub(now).Hours() / 24))
		if d < 0 {
			d = 0
		}
		daysLeft = &d
	}

	if customLimitBytes != nil {
		r := *customLimitBytes - usedBytes
		if r < 0 {
			r = 0
		}
		remainingBytes = &r
	}

	return status, daysLeft, remainingBytes, shouldBeEnabled
}

// RenewalTarget computes the new quota ceiling and end date for a top-up.
//
// addGB is a *relative* top-up: the new ceiling is usedBytes + addGB, so the
// holder always gets a fresh addGB of headroom regardless of prior usage.
// addDays extends from max(now, current end date), so renewing early never
// throws away unused time. A zero or negative value leaves that dimension
// untouched.
func RenewalTarget(now time.Time, key Key, addGB float64, addDays int) (limitBytes *int64, endDate *time.Time) {
	limitBytes, endDate = key.CustomLimitBytes, key.EndDate

	if addGB > 0 {
		v := key.UsedBytes + int64(addGB*BytesPerGB)
		limitBytes = &v
	}
	if addDays > 0 {
		base := now
		if key.EndDate != nil && key.EndDate.After(base) {
			base = *key.EndDate
		}
		t := base.AddDate(0, 0, addDays)
		endDate = &t
	}
	return limitBytes, endDate
}

type UserStatus string

const (
	UserStatusActive   UserStatus = "active"
	UserStatusInactive UserStatus = "inactive"
)

// User is a key holder — the person a key is handed to, as opposed to an
// AdminUser, who operates this dashboard. A name and a free-text note are the
// whole record: keys are handed over in person or over whatever channel the
// admin already uses, and nothing here ever contacts the holder.
//
// A user owns zero or more keys, at most one per server in practice: the whole
// point of the type is that the same person on two servers is one record, not
// two unrelated key names.
type User struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Note      string     `json:"note"`
	Status    UserStatus `json:"status"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`

	// PrimaryKeyID is the key this user's dynamic access link resolves to. A
	// user may hold keys on several servers, but an ssconf:// link resolves to
	// exactly one connection, so one key has to be nominated. Nil for a user
	// with no keys yet — their link exists but resolves to nothing.
	PrimaryKeyID *string `json:"primaryKeyId"`

	// DynamicToken is the opaque id in the user's ssconf:// link. It belongs to
	// the *person*, so swapping which key backs them (a new server, a reissued
	// key) leaves the link they were given untouched. Never serialized directly
	// — it only leaves the API inside DynamicAccessURL or via /dkey/:token.
	DynamicToken string `json:"-"`

	// DynamicAccessURL is the ssconf:// link to hand this user. Populated by
	// the handler layer, which is the only place that knows the deployment's
	// public base URL; empty when PUBLIC_BASE_URL is not configured.
	DynamicAccessURL string `json:"dynamicAccessUrl"`
}

// UserWithKeys is the list/detail shape: a user plus their keys and the
// rolled-up figures the users table shows without a second request per row.
type UserWithKeys struct {
	User
	Keys []Key `json:"keys"`
	// KeyCount / ActiveKeys / TotalUsedBytes are derived from Keys, filled in
	// by SummarizeUser so the table and the detail page agree on the numbers.
	KeyCount       int   `json:"keyCount"`
	ActiveKeys     int   `json:"activeKeys"`
	TotalUsedBytes int64 `json:"totalUsedBytes"`

	// PrimaryKey is the Keys entry matching User.PrimaryKeyID, lifted out so
	// the users table can show one server / key name / usage / expiry per row
	// without every client re-deriving it. Nil for a user with no keys.
	PrimaryKey *Key `json:"primaryKey"`
}

// SummarizeUser fills the rolled-up counters from the (already enriched) key
// slice, so "active" reflects live status rather than the cached column, and
// resolves PrimaryKey against the same slice.
func SummarizeUser(u UserWithKeys) UserWithKeys {
	if u.Keys == nil {
		u.Keys = []Key{}
	}
	u.KeyCount = len(u.Keys)
	u.ActiveKeys = 0
	u.TotalUsedBytes = 0
	u.PrimaryKey = nil
	for i, k := range u.Keys {
		if k.Status == StatusActive {
			u.ActiveKeys++
		}
		u.TotalUsedBytes += k.UsedBytes
		if u.PrimaryKeyID != nil && k.ID == *u.PrimaryKeyID {
			u.PrimaryKey = &u.Keys[i]
		}
	}
	return u
}

type AdminStatus string

const (
	AdminStatusActive    AdminStatus = "active"
	AdminStatusSuspended AdminStatus = "suspended"
)

// AdminUser is a dashboard operator authenticated via email OTP. IsRoot is
// computed at read time from config.RootAdminEmail, never persisted, so it
// can't be tampered with through the admin_users table itself.
type AdminUser struct {
	ID        string      `json:"id"`
	Email     string      `json:"email"`
	Status    AdminStatus `json:"status"`
	IsRoot    bool        `json:"isRoot"`
	CreatedAt time.Time   `json:"createdAt"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

// UserShare is the public "share view" link for one user. PasscodeHash is nil
// until the holder's first visit sets it — that nil-ness is what tells
// the public page whether to show the passcode-setup screen or the
// passcode-entry screen. FailedAttempts/LockedUntil throttle brute-forcing
// the 6-digit passcode.
//
// Scoped to the user rather than the key so re-provisioning someone doesn't
// invalidate the URL they were sent or the passcode they chose.
type UserShare struct {
	ID             string     `json:"id"`
	UserID         string     `json:"userId"`
	Slug           string     `json:"slug"`
	PasscodeHash   *string    `json:"-"`
	PasscodeSetAt  *time.Time `json:"passcodeSetAt"`
	FailedAttempts int        `json:"-"`
	LockedUntil    *time.Time `json:"-"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// DashboardStats is the payload for GET /api/stats.
type DashboardStats struct {
	TotalServers      int   `json:"totalServers"`
	TotalKeys         int   `json:"totalKeys"`
	ActiveKeys        int   `json:"activeKeys"`
	ExpiredKeys       int   `json:"expiredKeys"`
	LimitExceededKeys int   `json:"limitExceededKeys"`
	CombinedUsedBytes int64 `json:"combinedUsedBytes"`
}
