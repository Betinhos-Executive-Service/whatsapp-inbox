import { z } from "zod";
import type { Store } from "./db.ts";

/** Preferências do app. Ficam no banco local (tabela settings, chave "prefs"). */
export const prefsSchema = z.object({
  notifyEnabled: z.boolean(),
  notifySound: z.boolean(),
  /** Mostrar o texto da mensagem na notificação (desligado = só "Nova mensagem"). */
  notifyPreview: z.boolean(),
  /** Horário de silêncio "HH:mm"; os dois vazios = desligado. Pode atravessar a meia-noite. */
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  startWithWindows: z.boolean(),
  startMinimized: z.boolean(),
});

export type Prefs = z.infer<typeof prefsSchema>;

export const DEFAULT_PREFS: Prefs = {
  notifyEnabled: true,
  notifySound: true,
  notifyPreview: true,
  quietStart: null,
  quietEnd: null,
  startWithWindows: false,
  startMinimized: true,
};

export function readPrefs(store: Store): Prefs {
  try {
    const saved = JSON.parse(store.getSetting("prefs") ?? "{}");
    const parsed = prefsSchema.partial().safeParse(saved);
    return { ...DEFAULT_PREFS, ...(parsed.success ? parsed.data : {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(store: Store, patch: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(store), ...patch };
  store.setSetting("prefs", JSON.stringify(next));
  return next;
}

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Dentro do horário de silêncio, no fuso de São Paulo. */
export function inQuietHours(prefs: Prefs, now = new Date()): boolean {
  if (!prefs.quietStart || !prefs.quietEnd || prefs.quietStart === prefs.quietEnd) return false;
  const t = clock.format(now);
  return prefs.quietStart < prefs.quietEnd
    ? t >= prefs.quietStart && t < prefs.quietEnd
    : t >= prefs.quietStart || t < prefs.quietEnd;
}
