import assert from "node:assert/strict";
import { test } from "node:test";
import { EMOJIS } from "../ui/emoji-data.ts";
import { convertEmoticon, emojiQuery, insertAt, insertEmojiShortcut, pushRecent, searchEmoji, undoEmoticon } from "../ui/emoji-text.ts";

test("emoji: atalho ':texto' detecta 2+ letras depois de ':' no começo ou após espaço", () => {
  assert.equal(emojiQuery("Oi :jo", 6), "jo");
  assert.equal(emojiQuery(":coração", 8), "coração");
  assert.equal(emojiQuery("Oi :j", 5), null, "uma letra ainda não sugere");
  assert.equal(emojiQuery("às 10:30", 8), null, "hora não é atalho");
  assert.equal(emojiQuery("http://site", 11), null);
  assert.equal(emojiQuery("Oi :jo tudo", 11), null, "depois do espaço já saiu do atalho");
});

test("emoji: busca nas palavras-chave CLDR pt e en, sem acento, exato primeiro", () => {
  const first = (q: string) => searchEmoji(q, EMOJIS)[0]?.char;
  assert.equal(first("polegar"), "👍️");
  assert.equal(first("valeu"), "👍️");
  assert.equal(first("thumbs_up"), "👍️");
  assert.ok(searchEmoji("CORAÇÃO", EMOJIS, 10).some((e) => e.char === "❤️"), "sem acento e com maiúscula");
  assert.ok(searchEmoji("joia", EMOJIS, 8).some((e) => e.char === "👍️"));
  assert.equal(first("joys"), "🕹️", "português (joystick) antes do inglês");
  assert.ok(searchEmoji("joy", EMOJIS, 8).some((e) => e.char === "😂"), "inglês também sugere");
  assert.equal(searchEmoji("carro", EMOJIS, 3).length, 3);
  assert.deepEqual(searchEmoji("zzzzqq", EMOJIS), []);
});

test("emoji: emoticon vira emoji só no começo ou após espaço, e Backspace desfaz", () => {
  const conv = convertEmoticon("Oi :-)", 6);
  assert.ok(conv);
  assert.equal(conv.text, "Oi 🙂");
  assert.equal(convertEmoticon("Oi :-D", 6)?.text, "Oi 😀");
  assert.equal(convertEmoticon("te amo <3", 9)?.text, "te amo ❤️");
  assert.equal(convertEmoticon("(Y)", 3)?.text, "👍");
  assert.equal(convertEmoticon("Oi :)", 5), null, "sem nariz fica texto");
  assert.equal(convertEmoticon("a:-)", 4), null, "colado na palavra não troca");
  assert.deepEqual(undoEmoticon(conv.text, conv.swap), { text: "Oi :-)", caret: 6 });
  assert.equal(undoEmoticon("Oi tudo", conv.swap), null);
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
