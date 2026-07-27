package models

import (
	"testing"
	"time"

	"outline-manager/internal/outline"
)

// sample mirrors a real response from a live Outline server (v1.12.3), so the
// conversion is pinned against the actual wire shape rather than a guess.
func sample() *outline.ServerMetrics {
	m := &outline.ServerMetrics{}
	m.Server.TunnelTime = outline.Seconds{Seconds: 32290.758262658077}
	m.Server.DataTransferred = outline.Bytes{Bytes: 6037988238.761707}
	m.Server.Bandwidth.Current = outline.BandwidthSample{
		Data: outline.Bytes{Bytes: 17123.08435903633}, Timestamp: 1784994153.762,
	}
	m.Server.Bandwidth.Peak = outline.BandwidthSample{
		Data: outline.Bytes{Bytes: 8646047.320438998}, Timestamp: 1784986800.5,
	}
	m.Server.Locations = []outline.LocationMetrics{{
		Location: "MM", ASN: 58952, ASOrg: "Frontiir Co., Ltd",
		DataTransferred: outline.Bytes{Bytes: 6037988238.761707},
		TunnelTime:      outline.Seconds{Seconds: 32290.758262658077},
	}}
	return m
}

func TestBuildServerMetrics(t *testing.T) {
	got := BuildServerMetrics(time.Now(), "30d", sample())

	if got.TotalBytes != 6037988238 {
		t.Errorf("TotalBytes = %d, want 6037988238", got.TotalBytes)
	}
	if got.CurrentBandwidthBps != 17123 {
		t.Errorf("CurrentBandwidthBps = %d, want 17123", got.CurrentBandwidthBps)
	}
	if got.PeakBandwidthBps != 8646047 {
		t.Errorf("PeakBandwidthBps = %d, want 8646047", got.PeakBandwidthBps)
	}
	// 32290.76s / 3600 = 8.969h — the Outline Manager UI shows this as "8.886
	// hours" for a slightly earlier reading of the same counter.
	if h := got.TunnelTimeHours; h < 8.9 || h > 9.0 {
		t.Errorf("TunnelTimeHours = %v, want ~8.97", h)
	}
	// Outline sends fractional Unix seconds; the fraction must survive.
	if got.PeakBandwidthAt == nil || got.PeakBandwidthAt.Unix() != 1784986800 {
		t.Fatalf("PeakBandwidthAt = %v, want unix 1784986800", got.PeakBandwidthAt)
	}
	if ns := got.PeakBandwidthAt.Nanosecond(); ns < 4e8 || ns > 6e8 {
		t.Errorf("PeakBandwidthAt nanoseconds = %d, want ~5e8 (the .5)", ns)
	}
	if len(got.ASes) != 1 {
		t.Fatalf("len(ASes) = %d, want 1", len(got.ASes))
	}
	as := got.ASes[0]
	if as.ASN != 58952 || as.ASOrg != "Frontiir Co., Ltd" || as.CountryCode != "MM" {
		t.Errorf("AS = %+v, want AS58952 Frontiir Co., Ltd / MM", as)
	}
	if as.SharePct != 100 {
		t.Errorf("SharePct = %v, want 100 (sole AS)", as.SharePct)
	}
}

// Shares must be computed against summed AS traffic, not the server total:
// Outline only attributes traffic it can geolocate, so dividing by the server
// total would leave the shares quietly short of 100%.
func TestBuildServerMetricsSharesSumTo100(t *testing.T) {
	m := sample()
	m.Server.DataTransferred = outline.Bytes{Bytes: 1000} // deliberately larger
	m.Server.Locations = []outline.LocationMetrics{
		{ASN: 1, ASOrg: "A", DataTransferred: outline.Bytes{Bytes: 300}},
		{ASN: 2, ASOrg: "B", DataTransferred: outline.Bytes{Bytes: 100}},
	}

	got := BuildServerMetrics(time.Now(), "30d", m)

	var sum float64
	for _, as := range got.ASes {
		sum += as.SharePct
	}
	if sum < 99.99 || sum > 100.01 {
		t.Errorf("shares sum to %v, want 100", sum)
	}
	// Heaviest AS first.
	if got.ASes[0].ASN != 1 {
		t.Errorf("ASes[0].ASN = %d, want 1 (sorted by traffic desc)", got.ASes[0].ASN)
	}
}

// PeakDevicesTotal sums each key's peak. Keys with no traffic have a nil
// Connection and must not be counted or panic.
func TestBuildServerMetricsPeakDevicesTotal(t *testing.T) {
	m := sample()
	withDevices := func(id, devices int) outline.AccessKeyMetrics {
		ak := outline.AccessKeyMetrics{AccessKeyID: id, Connection: &outline.KeyConnection{}}
		ak.Connection.PeakDeviceCount.Data = devices
		return ak
	}
	m.AccessKeys = []outline.AccessKeyMetrics{
		withDevices(1, 2),
		withDevices(2, 3),
		{AccessKeyID: 3}, // idle key, nil Connection
	}

	if got := BuildServerMetrics(time.Now(), "30d", m).PeakDevicesTotal; got != 5 {
		t.Errorf("PeakDevicesTotal = %d, want 5", got)
	}
}

func TestBuildServerMetricsNil(t *testing.T) {
	if got := BuildServerMetrics(time.Now(), "30d", nil); got != nil {
		t.Errorf("BuildServerMetrics(nil) = %+v, want nil", got)
	}
}

func TestBuildKeyMetrics(t *testing.T) {
	m := sample()
	m.AccessKeys = []outline.AccessKeyMetrics{{
		AccessKeyID:     1,
		DataTransferred: outline.Bytes{Bytes: 6037988238.761707},
		TunnelTime:      outline.Seconds{Seconds: 32290.758262658077},
	}}
	m.AccessKeys[0].Connection = &outline.KeyConnection{LastTrafficSeen: 1784993700.25}
	m.AccessKeys[0].Connection.PeakDeviceCount.Data = 2

	got := BuildKeyMetrics(time.Now(), m)

	// Keyed by Outline access-key id as a string, to join onto Key.OutlineKeyID.
	km, ok := got["1"]
	if !ok {
		t.Fatalf("no metrics for key id 1, got keys %v", got)
	}
	if km.BytesTransferred != 6037988238 {
		t.Errorf("BytesTransferred = %d", km.BytesTransferred)
	}
	if km.PeakDeviceCount != 2 {
		t.Errorf("PeakDeviceCount = %d, want 2", km.PeakDeviceCount)
	}
	if km.LastTrafficSeen == nil {
		t.Error("LastTrafficSeen = nil, want a timestamp")
	}
}

// The green "connected now" dot is LastTrafficSeen inside OnlineWindow, measured
// against the now we pass in — the same rule Outline Manager applies.
func TestBuildKeyMetricsIsOnline(t *testing.T) {
	const lastSeen = 1784993700.25
	seen := *unixSeconds(lastSeen)

	cases := []struct {
		name string
		now  time.Time
		want bool
	}{
		{"traffic a moment ago", seen.Add(30 * time.Second), true},
		{"traffic just inside the window", seen.Add(OnlineWindow - time.Second), true},
		{"traffic exactly at the cutoff", seen.Add(OnlineWindow), true},
		{"traffic older than the window", seen.Add(OnlineWindow + time.Second), false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := sample()
			m.AccessKeys = []outline.AccessKeyMetrics{{
				AccessKeyID: 1,
				Connection:  &outline.KeyConnection{LastTrafficSeen: lastSeen},
			}}

			if got := BuildKeyMetrics(tc.now, m)["1"].IsOnline; got != tc.want {
				t.Errorf("IsOnline = %v, want %v", got, tc.want)
			}
			// The per-server count must agree with the per-key flag.
			wantCount := 0
			if tc.want {
				wantCount = 1
			}
			if got := BuildServerMetrics(tc.now, "30d", m).OnlineKeys; got != wantCount {
				t.Errorf("OnlineKeys = %d, want %d", got, wantCount)
			}
		})
	}
}

// A key that moved no traffic in the window has a nil Connection: offline, and
// it must not be counted as online for want of a timestamp.
func TestOnlineKeysIgnoresIdleKeys(t *testing.T) {
	m := sample()
	m.AccessKeys = []outline.AccessKeyMetrics{
		{AccessKeyID: 1}, // nil Connection
		{AccessKeyID: 2, Connection: &outline.KeyConnection{LastTrafficSeen: 1784993700.25}},
	}
	now := unixSeconds(1784993700.25).Add(time.Minute)

	if got := BuildServerMetrics(now, "30d", m).OnlineKeys; got != 1 {
		t.Errorf("OnlineKeys = %d, want 1", got)
	}
	if got := BuildKeyMetrics(now, m)["1"].IsOnline; got {
		t.Error("IsOnline = true for a key with no traffic in the window")
	}
}

// A key with no traffic in the window comes back with a nil Connection block;
// it must still get an entry so the UI can tell "idle" from "unknown".
func TestBuildKeyMetricsWithoutConnection(t *testing.T) {
	m := sample()
	m.AccessKeys = []outline.AccessKeyMetrics{{AccessKeyID: 7}}

	km, ok := BuildKeyMetrics(time.Now(), m)["7"]
	if !ok {
		t.Fatal("key 7 missing")
	}
	if km.LastTrafficSeen != nil || km.PeakDeviceCount != 0 {
		t.Errorf("got %+v, want zero-valued connection fields", km)
	}
}

func TestDeriveServerHealth(t *testing.T) {
	now := time.Now()
	syncErr := "boom"
	empty := ""

	cases := []struct {
		name      string
		err       *string
		syncedAt  *time.Time
		metricsOK bool
		want      ServerHealth
	}{
		// Nothing works: offline.
		{"never synced and unreachable", nil, nil, false, HealthOffline},
		{"sync failed and unreachable", &syncErr, nil, false, HealthOffline},
		{"sync failed, stale success, unreachable", &syncErr, &now, false, HealthOffline},

		// Reachable right now, but the sync side is not right. A server added
		// moments ago sits here until its first key sync lands — it must not
		// read as offline while it is plainly serving traffic.
		{"reachable but never synced", nil, nil, true, HealthDegraded},
		{"reachable but last sync failed", &syncErr, &now, true, HealthDegraded},

		// Synced fine before, but we cannot read it now.
		{"synced but metrics unreadable", nil, &now, false, HealthDegraded},

		// Both sides good.
		{"synced and metrics readable", nil, &now, true, HealthHealthy},
		{"empty error string is not an error", &empty, &now, true, HealthHealthy},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := DeriveServerHealth(tc.err, tc.syncedAt, tc.metricsOK); got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestServerHostname(t *testing.T) {
	s := Server{APIURL: "https://light-speed-data1.invisigate.asia:26574/s3zsxNk2"}
	if got := s.Hostname(); got != "light-speed-data1.invisigate.asia" {
		t.Errorf("Hostname() = %q", got)
	}
}
