const TZ = "America/Sao_Paulo";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const time = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const build = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatTime = (ms: number) => time.format(ms);

/** Rótulo do dia: "Hoje", "Ontem" ou dd/mm/aaaa, no fuso de São Paulo. */
export function dayLabel(ms: number, now = Date.now()): string {
  const key = dayKey.format(ms);
  if (key === dayKey.format(now)) return "Hoje";
  if (key === dayKey.format(now - 86400000)) return "Ontem";
  return date.format(ms);
}

export const sameDay = (a: number, b: number) => dayKey.format(a) === dayKey.format(b);

/** Hora de hoje, "Ontem" ou data — usado na lista de conversas. */
export function listTime(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const label = dayLabel(ms, now);
  return label === "Hoje" ? formatTime(ms) : label;
}

/** `v0.0.1 · dd/mm/aaaa HH:mm` em America/Sao_Paulo. */
export function formatBuild(version: string, iso: string): string {
  const d = new Date(iso);
  return `v${version} · ${Number.isNaN(d.getTime()) ? "" : build.format(d).replace(",", "")}`;
}

export const percent = (p: number) => `${Math.round(p * 100)}%`;

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "#";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const strip = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
export const matches = (haystack: string, needle: string) => strip(haystack).includes(strip(needle));
