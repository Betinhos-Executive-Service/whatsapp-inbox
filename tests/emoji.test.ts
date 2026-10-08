import assert from "node:assert/strict";
import { test } from "node:test";
import { EMOJIS } from "../ui/emoji-data.ts";
import { emojiQuery, insertAt, insertEmojiShortcut, pushRecent, searchEmoji } from "../ui/emoji-text.ts";

test("emoji: atalho ':texto' detecta 2+ letras depois de ':' no começo ou após espaço", () => {
  assert.equal(emojiQuery("Oi :jo", 6), "jo");
  assert.equal(emojiQuery(":coração", 8), "coração");
  assert.equal(emojiQuery("Oi :j", 5), null, "uma letra ainda não sugere");
  assert.equal(emojiQuery("às 10:30", 8), null, "hora não é atalho");
  assert.equal(emojiQuery("http://site", 11), null);
  assert.equal(emojiQuery("Oi :jo tudo", 11), null, "depois do espaço já saiu do atalho");
});

test("emoji: busca sem acento, exato e prefixo primeiro", () => {
  assert.equal(searchEmoji("joinha")[0].char, "👍");
  assert.equal(searchEmoji("coracao")[0].char, "❤️");
  assert.equal(searchEmoji("CORAÇÃO")[0].char, "❤️");
  assert.equal(searchEmoji("kkk")[0].char, "😂");
  assert.equal(searchEmoji("carro", 3).length, 3);
  assert.deepEqual(searchEmoji("zzzzqq"), []);
});

test("emoji: insere no lugar do atalho ou da seleção", () => {
  assert.deepEqual(insertEmojiShortcut("Valeu :joi!", 10, "👍"), { text: "Valeu 👍!", caret: "Valeu 👍".length });
  assert.deepEqual(insertAt("Oi tudo", 2, 2, "😀"), { text: "Oi😀 tudo", caret: 2 + "😀".length });
  assert.deepEqual(insertAt("Oi XX", 3, 5, "🙏"), { text: "Oi 🙏", caret: 3 + "🙏".length });
  assert.deepEqual(pushRecent(["😀", "👍"], "👍"), ["👍", "😀"]);
  assert.equal(pushRecent([], "a", 2).length, 1);
});

test("emoji: lista sem repetidos e com palavra-chave", () => {
  const chars = EMOJIS.map((e) => e.char);
  assert.equal(new Set(chars).size, chars.length);
  assert.ok(EMOJIS.every((e) => e.keys.length > 0));
});
