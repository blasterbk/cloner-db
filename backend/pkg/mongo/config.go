package mongo

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// EndpointConfig holds connection parameters for a MongoDB instance or cluster.
type EndpointConfig struct {
	URI              string `json:"uri"`               // Full connection URI (takes priority)
	Host             string `json:"host"`              // Hostname or IP
	Port             int    `json:"port"`              // Port (default: 27017)
	Username         string `json:"username"`          // Username
	Password         string `json:"password"`          // Password
	AuthSource       string `json:"auth_source"`       // Auth database (default: "admin")
	ReplicaSet       string `json:"replica_set"`       // Replica set name (if applicable)
	TLSEnabled       bool   `json:"tls_enabled"`       // Use TLS/SSL
	TLSSkipVerify    bool   `json:"tls_skip_verify"`   // Skip TLS certificate verification
	DirectConnection bool   `json:"direct_connection"` // Force direct connection to host
	TimeoutMs        int    `json:"timeout_ms"`        // Connect timeout in milliseconds
}

// GetEffectiveURI returns the formatted MongoDB connection URI string.
func (c *EndpointConfig) GetEffectiveURI() string {
	if strings.TrimSpace(c.URI) != "" {
		return strings.TrimSpace(c.URI)
	}

	port := c.Port
	if port <= 0 {
		port = 27017
	}

	host := c.Host
	if host == "" {
		host = "127.0.0.1"
	}

	var uri strings.Builder
	uri.WriteString("mongodb://")

	if c.Username != "" {
		uri.WriteString(url.QueryEscape(c.Username))
		if c.Password != "" {
			uri.WriteString(":" + url.QueryEscape(c.Password))
		}
		uri.WriteString("@")
	}

	uri.WriteString(fmt.Sprintf("%s:%d", host, port))
	uri.WriteString("/")

	params := url.Values{}
	authSrc := c.AuthSource
	if authSrc == "" && c.Username != "" {
		authSrc = "admin"
	}
	if authSrc != "" {
		params.Set("authSource", authSrc)
	}
	if c.ReplicaSet != "" {
		params.Set("replicaSet", c.ReplicaSet)
	}
	if c.TLSEnabled {
		params.Set("tls", "true")
		if c.TLSSkipVerify {
			params.Set("tlsInsecure", "true")
		}
	}
	if c.DirectConnection {
		params.Set("directConnection", "true")
	}

	encodedParams := params.Encode()
	if encodedParams != "" {
		uri.WriteString("?" + encodedParams)
	}

	return uri.String()
}

// MaskedURI returns the connection string with sensitive credentials obfuscated for UI display and logs.
func (c *EndpointConfig) MaskedURI() string {
	raw := c.GetEffectiveURI()
	parsed, err := url.Parse(raw)
	if err != nil {
		return "[redacted-uri]"
	}
	if parsed.User != nil {
		username := parsed.User.Username()
		_, hasPass := parsed.User.Password()
		if hasPass {
			parsed.User = url.UserPassword(username, "******")
		} else {
			parsed.User = url.User(username)
		}
	}
	return parsed.String()
}

// GetTimeout returns connection timeout duration.
func (c *EndpointConfig) GetTimeout() time.Duration {
	if c.TimeoutMs <= 0 {
		return 10 * time.Second
	}
	return time.Duration(c.TimeoutMs) * time.Millisecond
}
