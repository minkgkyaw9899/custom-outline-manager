package outline

import (
	"sync"
	"time"
)

// Cache hands out one Client per server, rebuilding it when the stored URL or
// fingerprint changes (e.g. the operator re-pins a rotated cert). Clients hold
// a pooled http.Transport, so reusing them across requests matters.
type Cache struct {
	mu      sync.Mutex
	clients map[string]*cachedClient
	timeout time.Duration
}

type cachedClient struct {
	client     *Client
	apiURL     string
	certSHA256 string
}

func NewCache(timeout time.Duration) *Cache {
	return &Cache{clients: make(map[string]*cachedClient), timeout: timeout}
}

func (c *Cache) Get(serverID, apiURL, certSHA256 string) (*Client, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if cc, ok := c.clients[serverID]; ok && cc.apiURL == apiURL && cc.certSHA256 == certSHA256 {
		return cc.client, nil
	}

	client, err := New(apiURL, certSHA256, c.timeout)
	if err != nil {
		return nil, err
	}
	c.clients[serverID] = &cachedClient{client: client, apiURL: apiURL, certSHA256: certSHA256}
	return client, nil
}

func (c *Cache) Invalidate(serverID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.clients, serverID)
}
