package store

import (
	"errors"
	"testing"
)

func TestGrantCodeAndTokenRoundtrip(t *testing.T) {
	db := testDB(t)
	gid, err := CreateGroup(db, "G")
	if err != nil {
		t.Fatal(err)
	}

	id, err := CreateGrant(db, &Grant{GroupID: gid, Token: "tok-abc", NumericCode: "12345678", Enabled: true, SessionTTLDays: 30})
	if err != nil {
		t.Fatal(err)
	}
	g, err := GetGrantByCode(db, "12345678")
	if err != nil {
		t.Fatalf("GetGrantByCode 应命中: %v", err)
	}
	if g.ID != id || !g.Enabled {
		t.Fatalf("grant 字段不符: %+v", g)
	}

	g2, err := GetGrantByToken(db, "tok-abc")
	if err != nil || g2.ID != id {
		t.Fatalf("GetGrantByToken 应命中: %v", err)
	}

	if _, err := GetGrantByCode(db, "99999999"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("不存在的码应 NotFound, got %v", err)
	}
}

func TestUpdateGrantRegenerate(t *testing.T) {
	db := testDB(t)
	gid, _ := CreateGroup(db, "G")
	id, _ := CreateGrant(db, &Grant{GroupID: gid, Token: "t1", NumericCode: "11111111", SessionTTLDays: 30})

	newCode := "22222222"
	if err := UpdateGrant(db, id, GrantPatch{NumericCode: &newCode}); err != nil {
		t.Fatal(err)
	}
	if _, err := GetGrantByCode(db, "11111111"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("旧码应失效: %v", err)
	}
	g, err := GetGrantByCode(db, "22222222")
	if err != nil {
		t.Fatalf("新码应命中: %v", err)
	}
	if g.ID != id {
		t.Fatalf("新码应指向同一授权")
	}

	disabled := false
	if err := UpdateGrant(db, id, GrantPatch{Enabled: &disabled}); err != nil {
		t.Fatal(err)
	}
	g, _ = GetGrant(db, id)
	if g.Enabled {
		t.Fatal("授权应已禁用")
	}
}
