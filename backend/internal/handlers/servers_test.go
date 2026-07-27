package handlers

import "testing"

// The Outline installer prints its management key as a JSON blob with the
// fingerprint as a *separate field* — it is not embedded in the URL. Operators
// paste that whole blob, so the single URL field has to accept it.
func TestParseManagementKey(t *testing.T) {
	const (
		url  = "https://light-speed-data1.invisigate.asia:26574/s3zsxNk2Vln3IDvgSiqBWg"
		cert = "F5D4B4E67644E4F8871FDE2D21FE90255BE9F045CA8D257A87869DD98A9BDC4A"
		want = "f5d4b4e67644e4f8871fde2d21fe90255be9f045ca8d257a87869dd98a9bdc4a"
	)

	cases := []struct {
		name         string
		urlField     string
		certField    string
		wantURL      string
		wantCertHash string
	}{
		{
			name:         "full installer JSON blob pasted into the url field",
			urlField:     `{"apiUrl":"` + url + `","certSha256":"` + cert + `"}`,
			wantURL:      url,
			wantCertHash: want,
		},
		{
			name:         "blob with surrounding whitespace",
			urlField:     "\n  " + `{"apiUrl":"` + url + `","certSha256":"` + cert + `"}` + "  \n",
			wantURL:      url,
			wantCertHash: want,
		},
		{
			name:         "bare url plus separate cert field",
			urlField:     url,
			certField:    cert,
			wantURL:      url,
			wantCertHash: want,
		},
		{
			name:         "colon-separated fingerprint is normalized",
			urlField:     url,
			certField:    "F5:D4:B4:E6",
			wantURL:      url,
			wantCertHash: "f5d4b4e6",
		},
		{
			name:         "explicit cert field wins when the blob omits one",
			urlField:     `{"apiUrl":"` + url + `"}`,
			certField:    cert,
			wantURL:      url,
			wantCertHash: want,
		},
		{
			name:         "malformed json is left alone for url validation to reject",
			urlField:     `{"apiUrl":`,
			wantURL:      `{"apiUrl":`,
			wantCertHash: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotURL, gotCert := parseManagementKey(tc.urlField, tc.certField)
			if gotURL != tc.wantURL {
				t.Errorf("url = %q, want %q", gotURL, tc.wantURL)
			}
			if gotCert != tc.wantCertHash {
				t.Errorf("cert = %q, want %q", gotCert, tc.wantCertHash)
			}
		})
	}
}
