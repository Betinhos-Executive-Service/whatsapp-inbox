import assert from "node:assert/strict";
import { test } from "node:test";
import { circleMask } from "../desktop/avatar-mask.ts";

const SIZE = 96;
const alpha = (buf: Buffer, x: number, y: number) => buf[(y * SIZE + x) * 4 + 3];

test("máscara circular: cantos transparentes, miolo e bordas do círculo opacos, borda suavizada", () => {
  const out = circleMask(Buffer.alloc(SIZE * SIZE * 4, 255), SIZE);
  assert.equal(alpha(out, 0, 0), 0);
  assert.equal(alpha(out, SIZE - 1, SIZE - 1), 0);
  assert.equal(alpha(out, 13, 13), 0);
  assert.equal(alpha(out, 48, 48), 255);
  assert.equal(alpha(out, 0, 48), 255);
  assert.equal(alpha(out, 48, 0), 255);
  let partial = 0;
  for (let i = 3; i < out.length; i += 4) if (out[i] > 0 && out[i] < 255) partial++;
  assert.ok(partial > 0, "borda precisa de pixels semitransparentes");
});

test("máscara circular: pré-multiplica as cores junto com o alfa e não altera a entrada", () => {
  const input = Buffer.alloc(SIZE * SIZE * 4, 200);
  const out = circleMask(input, SIZE);
  assert.equal(input[3], 200);
  const i = 0;
  assert.deepEqual([out[i], out[i + 1], out[i + 2], out[i + 3]], [0, 0, 0, 0]);
});
