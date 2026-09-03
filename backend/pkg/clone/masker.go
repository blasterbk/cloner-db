package clone

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"go.mongodb.org/mongo-driver/bson"

	"github.com/mongoclone/engine/pkg/types"
)

// DataMasker manages the lookup and application of sanitization rules to BSON documents.
type DataMasker struct {
	rulesMap map[string][]types.MaskRule // key: "db.collection" -> rules
}

// NewDataMasker initializes a DataMasker with a list of rules.
func NewDataMasker(rules []types.MaskRule) *DataMasker {
	m := &DataMasker{
		rulesMap: make(map[string][]types.MaskRule),
	}
	for _, r := range rules {
		key := fmt.Sprintf("%s.%s", r.DatabaseName, r.CollectionName)
		m.rulesMap[key] = append(m.rulesMap[key], r)
	}
	return m
}

// HasRules returns true if there are any active rules for the given database and collection.
func (m *DataMasker) HasRules(db, coll string) bool {
	key := fmt.Sprintf("%s.%s", db, coll)
	return len(m.rulesMap[key]) > 0
}

// MaskDocument applies all matching masking rules recursively to a BSON document.
func (m *DataMasker) MaskDocument(db, coll string, doc bson.M) bson.M {
	key := fmt.Sprintf("%s.%s", db, coll)
	rules, exists := m.rulesMap[key]
	if !exists || len(rules) == 0 {
		return doc
	}

	for _, rule := range rules {
		applyRule(doc, strings.Split(rule.FieldPath, "."), rule)
	}

	return doc
}

func applyRule(current bson.M, path []string, rule types.MaskRule) {
	if len(path) == 0 || current == nil {
		return
	}

	field := path[0]

	// Base case: at the target field
	if len(path) == 1 {
		val, exists := current[field]
		if !exists {
			return
		}

		if rule.Type == types.MaskTypeRemoveField {
			delete(current, field)
			return
		}

		current[field] = maskValue(val, rule)
		return
	}

	// Recursive case for nested maps or arrays
	nextVal, exists := current[field]
	if !exists || nextVal == nil {
		return
	}

	if nestedMap, ok := nextVal.(bson.M); ok {
		applyRule(nestedMap, path[1:], rule)
	} else if nestedD, ok := nextVal.(bson.D); ok {
		m := nestedD.Map()
		applyRule(m, path[1:], rule)
		current[field] = m
	} else if nestedArr, ok := nextVal.(bson.A); ok {
		for _, item := range nestedArr {
			if itemMap, ok := item.(bson.M); ok {
				applyRule(itemMap, path[1:], rule)
			}
		}
	}
}

func maskValue(val any, rule types.MaskRule) any {
	strVal := fmt.Sprintf("%v", val)

	switch rule.Type {
	case types.MaskTypeEmail:
		hash := sha256.Sum256([]byte(strVal))
		hexHash := hex.EncodeToString(hash[:4])
		return fmt.Sprintf("user_%s@example.com", hexHash)

	case types.MaskTypePhone:
		return "+1-555-0199"

	case types.MaskTypePassword:
		return "$2a$12$e8xL8wI7y9M3r9.Z1t8w.e8xL8wI7y9M3r9.Z1t8w.e8xL8wI7y"

	case types.MaskTypeCreditCard:
		return "XXXX-XXXX-XXXX-0000"

	case types.MaskTypeHashSHA256:
		hash := sha256.Sum256([]byte(strVal))
		return hex.EncodeToString(hash[:])

	case types.MaskTypeFixedValue:
		if rule.CustomValue != "" {
			return rule.CustomValue
		}
		return "[REDACTED]"

	case types.MaskTypeRegexReplace:
		if rule.RegexPattern != "" {
			re, err := regexp.Compile(rule.RegexPattern)
			if err == nil {
				return re.ReplaceAllString(strVal, rule.RegexReplace)
			}
		}
		return strVal

	default:
		return "[MASKED]"
	}
}
