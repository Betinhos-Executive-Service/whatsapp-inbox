import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { autostartEntry, setAutostart } from "../desktop/linux.ts";

const exec = (exe: string, hidden = false) => autostartEntry(exe, hidden).match(/^Exec=(.*)$/m)?.[1];

test("linux: Exec= do .desktop com aspas e caracteres especiais escapados", () => {
  assert.equal(exec("/home/ana/Apps/WhatsApp Inbox.AppImage"), '"/home/ana/Apps/WhatsApp Inbox.AppImage"');
  assert.equal(exec(String.raw`/x/a"b$c\d`, true), String.raw`"/x/a\\"b\\$c\\\\d" --hidden`);
  assert.equal(exec("/x/a`b"), '"/x/a\\\\`b"');
  assert.equal(exec("/x/100%"), '"/x/100%%"');
});

test("linux: início com o sistema cria e remove a entrada do autostart", () => {
  const config = mkdtempSync(join(tmpdir(), "autostart-"));
  const file = join(config, "autostart", "whatsapp-inbox.desktop");
  setAutostart(config, "/opt/app.AppImage", true, true);
  assert.equal(readFileSync(file, "utf8"), autostartEntry("/opt/app.AppImage", true));
  assert.match(readFileSync(file, "utf8"), /^Exec="\/opt\/app\.AppImage" --hidden$/m);
  setAutostart(config, "/opt/app.AppImage", true, false);
  assert.match(readFileSync(file, "utf8"), /^Exec="\/opt\/app\.AppImage"$/m);
  setAutostart(config, "/opt/app.AppImage", false, false);
  assert.equal(existsSync(file), false);
  setAutostart(config, "/opt/app.AppImage", false, false); // desligar de novo não falha
});
