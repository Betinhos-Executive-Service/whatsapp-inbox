import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { DEFAULT_PREFS, inQuietHours, readPrefs, savePrefs } from "../server/prefs.ts";

// 12:00 UTC = 09:00 em São Paulo; 02:00 UTC = 23:00 do dia anterior em São Paulo.
const at = (iso: string) => new Date(iso);

test("preferências: padrão, gravação parcial e valor inválido ignorado", () => {
  const s = new Store(":memory:");
  assert.deepEqual(readPrefs(s), DEFAULT_PREFS);
  savePrefs(s, { notifySound: false });
  assert.equal(readPrefs(s).notifySound, false);
  assert.equal(readPrefs(s).notifyEnabled, true);
  s.setSetting("prefs", "{quebrado");
  assert.deepEqual(readPrefs(s), DEFAULT_PREFS);
});

test("horário de silêncio no fuso de São Paulo, inclusive atravessando a meia-noite", () => {
  const night = { ...DEFAULT_PREFS, quietStart: "22:00", quietEnd: "07:00" };
  assert.equal(inQuietHours(night, at("2026-10-06T02:00:00Z")), true);
  assert.equal(inQuietHours(night, at("2026-10-06T12:00:00Z")), false);
  const lunch = { ...DEFAULT_PREFS, quietStart: "08:30", quietEnd: "10:00" };
  assert.equal(inQuietHours(lunch, at("2026-10-06T12:00:00Z")), true);
  assert.equal(inQuietHours(DEFAULT_PREFS, at("2026-10-06T02:00:00Z")), false);
});
