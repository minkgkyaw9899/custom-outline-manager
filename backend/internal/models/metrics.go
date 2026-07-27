package models

import (
	"sort"
	"strconv"
	"time"

	"outline-manager/internal/outline"
)

const secondsPerHour = 3600

// OnlineWindow is how recently a key must have moved traffic to count as
// currently connected. Outline Manager uses exactly this cutoff for the green
// dot on a key's avatar (see refreshAccessKeyTableUI in its www/app.ts), and
// matching it keeps this dashboard's "online" in step with the official app.
//
// It has to be a window rather than a live flag because Outline exposes no
// session state at all: the only per-key liveness signal is
// connection.lastTrafficSeen, a timestamp of the last byte it saw.
const OnlineWindow = 5 * time.Minute

// isOnline reports whether lastTrafficSeen is recent enough to count as
// connected. A nil timestamp means the key moved no traffic in the metrics
// window, so it is offline rather than unknown.
func isOnline(now time.Time, lastTrafficSeen *time.Time) bool {
	if lastTrafficSeen == nil {
		return false
	}
	return !lastTrafficSeen.Before(now.Add(-OnlineWindow))
}

// unixSeconds converts one of Outline's fractional Unix timestamps to a time,
// returning nil for the zero value ("never"). The fractional part is preserved
// as nanoseconds rather than truncated.
func unixSeconds(ts float64) *time.Time {
	if ts <= 0 {
		return nil
	}
	sec := int64(ts)
	nsec := int64((ts - float64(sec)) * float64(time.Second))
	t := time.Unix(sec, nsec).UTC()
	return &t
}

// BuildServerMetrics converts one raw Outline metrics response into the shape
// the dashboard renders.
//
// AS shares are computed against the summed AS traffic rather than the
// server-wide total: Outline attributes only traffic it could geolocate to an
// AS, so dividing by the server total would make the shares silently fail to
// reach 100% and look like a rounding bug. ASes come back sorted by traffic,
// heaviest first, which is the order the UI displays them in.
//
// now is passed in rather than read from the clock so OnlineKeys is derived from
// the same instant as the rest of the response (and stays testable).
func BuildServerMetrics(now time.Time, window string, m *outline.ServerMetrics) *ServerMetrics {
	if m == nil {
		return nil
	}

	out := &ServerMetrics{
		Window:              window,
		TotalBytes:          int64(m.Server.DataTransferred.Bytes),
		CurrentBandwidthBps: int64(m.Server.Bandwidth.Current.Data.Bytes),
		PeakBandwidthBps:    int64(m.Server.Bandwidth.Peak.Data.Bytes),
		TunnelTimeHours:     m.Server.TunnelTime.Seconds / secondsPerHour,
		ASes:                make([]ASUsage, 0, len(m.Server.Locations)),
	}

	out.PeakBandwidthAt = unixSeconds(m.Server.Bandwidth.Peak.Timestamp)

	var asTotal float64
	for _, loc := range m.Server.Locations {
		asTotal += loc.DataTransferred.Bytes
	}

	for _, loc := range m.Server.Locations {
		share := 0.0
		if asTotal > 0 {
			share = loc.DataTransferred.Bytes / asTotal * 100
		}
		out.ASes = append(out.ASes, ASUsage{
			ASN:              loc.ASN,
			ASOrg:            loc.ASOrg,
			CountryCode:      loc.Location,
			BytesTransferred: int64(loc.DataTransferred.Bytes),
			TunnelTimeHours:  loc.TunnelTime.Seconds / secondsPerHour,
			SharePct:         share,
		})
	}

	sort.SliceStable(out.ASes, func(i, j int) bool {
		return out.ASes[i].BytesTransferred > out.ASes[j].BytesTransferred
	})

	for _, ak := range m.AccessKeys {
		if ak.Connection == nil {
			continue
		}
		out.PeakDevicesTotal += ak.Connection.PeakDeviceCount.Data
		if isOnline(now, unixSeconds(ak.Connection.LastTrafficSeen)) {
			out.OnlineKeys++
		}
	}

	return out
}

// BuildKeyMetrics indexes the per-access-key metrics by Outline key id, so
// callers can join them onto locally-stored keys via Key.OutlineKeyID.
//
// A key with no traffic in the window has a nil Connection block; it still gets
// an entry so the UI can distinguish "no traffic recently" from "unknown".
func BuildKeyMetrics(now time.Time, m *outline.ServerMetrics) map[string]KeyMetrics {
	if m == nil {
		return nil
	}

	out := make(map[string]KeyMetrics, len(m.AccessKeys))
	for _, ak := range m.AccessKeys {
		km := KeyMetrics{
			BytesTransferred: int64(ak.DataTransferred.Bytes),
			TunnelTimeHours:  ak.TunnelTime.Seconds / secondsPerHour,
		}
		if ak.Connection != nil {
			km.LastTrafficSeen = unixSeconds(ak.Connection.LastTrafficSeen)
			km.PeakDeviceCount = ak.Connection.PeakDeviceCount.Data
			km.IsOnline = isOnline(now, km.LastTrafficSeen)
		}
		out[strconv.Itoa(ak.AccessKeyID)] = km
	}
	return out
}

// DeriveServerHealth maps sync state and live-metrics availability onto the
// traffic light the UI shows.
//
// The two inputs are not equally current, and that is the whole shape of this
// function. metricsOK is a live read performed for *this* request; lastSyncedAt
// and lastSyncError are stale facts left behind by the last cron sync. So:
//
//	offline  — nothing works: we could not read it now, and no sync has ever
//	           succeeded (or the last one failed).
//	degraded — partially working, either direction: reachable now but not yet
//	           (or no longer) syncing, or synced before but unreadable now.
//	healthy  — both a successful sync and a successful live read.
//
// Treating "never synced" as offline on its own was wrong: a server added
// moments ago has lastSyncedAt == nil for as long as its first key sync takes,
// and reported offline while plainly serving traffic.
//
// "Degraded" deliberately means "we reached it but couldn't read its metrics"
// rather than a load threshold: the design's load-percentage bar has no source
// in the Outline API, so inventing a threshold here would be inventing data.
func DeriveServerHealth(lastSyncError *string, lastSyncedAt *time.Time, metricsOK bool) ServerHealth {
	syncOK := lastSyncedAt != nil && (lastSyncError == nil || *lastSyncError == "")

	switch {
	case syncOK && metricsOK:
		return HealthHealthy
	case !syncOK && !metricsOK:
		return HealthOffline
	default:
		return HealthDegraded
	}
}
