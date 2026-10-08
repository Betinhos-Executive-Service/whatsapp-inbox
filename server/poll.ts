import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Voto de enquete do WhatsApp: cada voto vai cifrado (AES-256-GCM) com uma chave derivada do segredo
 * da enquete, do id dela, de quem criou e de quem votou. O conteúdo é a lista de SHA-256 das opções.
 * Mesmo esquema do decryptPollVote do Baileys, que não vem ligado e não sabe votar.
 */

export type EncVote = { encPayload: Uint8Array; encIv: Uint8Array };

export const optionHash = (name: string): Buffer => createHash("sha256").update(Buffer.from(name)).digest();

function voteKey(secret: Uint8Array, pollId: string, creator: string, voter: string): Buffer {
  const sign = Buffer.concat([Buffer.from(pollId), Buffer.from(creator), Buffer.from(voter), Buffer.from("Poll Vote"), Buffer.from([1])]);
  const key0 = createHmac("sha256", Buffer.alloc(32)).update(secret).digest();
  return createHmac("sha256", key0).update(sign).digest();
}

const aad = (pollId: string, voter: string) => Buffer.from(`${pollId}\u0000${voter}`);

/** PollVoteMessage { repeated bytes selectedOptions = 1 } em protobuf. */
function encodeVote(hashes: Uint8Array[]): Buffer {
  return Buffer.concat(hashes.flatMap((h) => [Buffer.from([0x0a]), varint(h.length), Buffer.from(h)]));
}

function varint(n: number): Buffer {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

function decodeVote(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let i = 0;
  const read = () => {
    let n = 0;
    let shift = 0;
    for (;;) {
      if (i >= buf.length) throw new Error("voto truncado");
      const b = buf[i++];
      n += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return n;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const tag = read();
    const wire = tag & 7;
    if (wire === 2) {
      const len = read();
      const bytes = buf.subarray(i, i + len);
      i += len;
      if (tag >>> 3 === 1) out.push(Buffer.from(bytes));
    } else if (wire === 0) read();
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else throw new Error("voto com campo desconhecido");
  }
  return out;
}

export function encryptVote(options: string[], ctx: { secret: Uint8Array; pollId: string; creator: string; voter: string }): EncVote {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", voteKey(ctx.secret, ctx.pollId, ctx.creator, ctx.voter), iv);
  cipher.setAAD(aad(ctx.pollId, ctx.voter));
  const body = Buffer.concat([cipher.update(encodeVote(options.map(optionHash))), cipher.final(), cipher.getAuthTag()]);
  return { encPayload: body, encIv: iv };
}

/**
 * Decifra tentando as formas possíveis de quem criou e de quem votou (número ou LID): o WhatsApp usa
 * a que estava valendo na conversa, e o aparelho conectado nem sempre sabe qual. null = nenhuma serviu.
 */
export function decryptVote(vote: EncVote, ctx: { secret: Uint8Array; pollId: string; creators: string[]; voters: string[] }): { hashes: Buffer[]; creator: string; voter: string } | null {
  const payload = Buffer.from(vote.encPayload);
  if (payload.length < 16) return null;
  const body = payload.subarray(0, -16);
  const tag = payload.subarray(-16);
  for (const creator of new Set(ctx.creators)) {
    for (const voter of new Set(ctx.voters)) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", voteKey(ctx.secret, ctx.pollId, creator, voter), vote.encIv);
        decipher.setAAD(aad(ctx.pollId, voter));
        decipher.setAuthTag(tag);
        // Devolve também a forma que serviu: diz se o outro lado endereça a enquete por número ou LID.
        return { hashes: decodeVote(Buffer.concat([decipher.update(body), decipher.final()])), creator, voter };
      } catch {
        // chave errada: tenta a próxima combinação
      }
    }
  }
  return null;
}

/** Hashes escolhidos → nomes das opções da enquete (hash desconhecido é ignorado). */
export function optionsFromHashes(options: string[], hashes: Uint8Array[]): string[] {
  const picked = new Set(hashes.map((h) => Buffer.from(h).toString("hex")));
  return options.filter((o) => picked.has(optionHash(o).toString("hex")));
}
