package clone

import (
	"testing"

	"go.mongodb.org/mongo-driver/bson"

	"github.com/mongoclone/engine/pkg/types"
)

func TestDataMasker_MaskDocument(t *testing.T) {
	rules := []types.MaskRule{
		{
			DatabaseName:   "ecommerce",
			CollectionName: "users",
			FieldPath:      "email",
			Type:           types.MaskTypeEmail,
		},
		{
			DatabaseName:   "ecommerce",
			CollectionName: "users",
			FieldPath:      "password",
			Type:           types.MaskTypePassword,
		},
		{
			DatabaseName:   "ecommerce",
			CollectionName: "users",
			FieldPath:      "profile.phone",
			Type:           types.MaskTypePhone,
		},
		{
			DatabaseName:   "ecommerce",
			CollectionName: "users",
			FieldPath:      "secret_token",
			Type:           types.MaskTypeRemoveField,
		},
	}

	masker := NewDataMasker(rules)

	if !masker.HasRules("ecommerce", "users") {
		t.Fatal("Expected rules to exist for ecommerce.users")
	}

	doc := bson.M{
		"name":         "John Doe",
		"email":        "john.doe@production.corp",
		"password":     "supersecret123",
		"secret_token": "xyz987654321",
		"profile": bson.M{
			"phone": "+1-202-555-0143",
			"city":  "San Francisco",
		},
	}

	masked := masker.MaskDocument("ecommerce", "users", doc)

	// Check email masked
	if masked["email"] == "john.doe@production.corp" {
		t.Fatal("Email was not masked")
	}

	// Check password replaced
	if masked["password"] == "supersecret123" {
		t.Fatal("Password was not masked")
	}

	// Check secret_token dropped
	if _, exists := masked["secret_token"]; exists {
		t.Fatal("Secret token should have been removed")
	}

	// Check nested phone masked
	profile, ok := masked["profile"].(bson.M)
	if !ok {
		t.Fatal("Profile should remain bson.M")
	}
	if profile["phone"] == "+1-202-555-0143" {
		t.Fatal("Phone was not masked")
	}
	if profile["city"] != "San Francisco" {
		t.Fatalf("Unmasked field city should be preserved, got %v", profile["city"])
	}
}
