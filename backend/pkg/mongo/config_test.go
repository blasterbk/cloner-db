package mongo

import (
	"testing"
)

func TestEndpointConfig_GetEffectiveURI(t *testing.T) {
	// Test direct URI
	cfg1 := EndpointConfig{
		URI: "mongodb://user:secret@mongo.prod.internal:27017/admin?replicaSet=rs0",
	}
	if cfg1.GetEffectiveURI() != cfg1.URI {
		t.Fatalf("Expected %s, got %s", cfg1.URI, cfg1.GetEffectiveURI())
	}

	// Test constructed URI
	cfg2 := EndpointConfig{
		Host:       "10.0.0.5",
		Port:       27018,
		Username:   "app_user",
		Password:   "p@ssw#rd",
		AuthSource: "admin",
		ReplicaSet: "rsProd",
		TLSEnabled: true,
	}
	uri := cfg2.GetEffectiveURI()
	if uri == "" {
		t.Fatal("URI should not be empty")
	}

	// Masked URI test
	masked := cfg2.MaskedURI()
	if masked == "" || masked == cfg2.Password {
		t.Fatalf("Password should be masked, got %s", masked)
	}
}
