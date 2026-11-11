// Links "abrir conversa" do WhatsApp (whatsapp://send, api.whatsapp.com/send, wa.me...) que o
// sistema entrega ao app: viram número + texto para abrir a conversa com o rascunho preenchido.
// Nunca envia nada: o texto só vai para a caixa de digitação.

export type WaLink = { phone: string; text: string };

/** Esquemas que o app registra no sistema. */
export const LINK_SCHEMES = ["whatsapp", "whatsapp-inbox"] as const;

const WEB_HOSTS = new Set(["api.whatsapp.com", "web.whatsapp.com", "wa.me", "www.wa.me"]);

/** Lê um link de conversa; null quando não é um link desses ou não traz número. */
export function parseWaLink(raw: string): WaLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  let phone: string | null = null;
  if ((LINK_SCHEMES as readonly string[]).includes(scheme)) {
    // whatsapp://send?phone=... (host "send") ou whatsapp://send/?phone=...
    if (url.hostname.toLowerCase() !== "send" && url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase() !== "send") return null;
    phone = url.searchParams.get("phone");
  } else if (scheme === "https" || scheme === "http") {
    const host = url.hostname.toLowerCase();
    if (!WEB_HOSTS.has(host)) return null;
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    if (host.endsWith("wa.me")) phone = path;
    else if (path.toLowerCase() === "send") phone = url.searchParams.get("phone");
    else return null;
  } else {
    return null;
  }
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return { phone: digits, text: url.searchParams.get("text") ?? "" };
}

/** Primeiro link de conversa na linha de comando (o Windows passa o link como argumento). */
export function linkFromArgv(argv: readonly string[]): WaLink | null {
  for (const arg of argv) {
    const link = parseWaLink(arg);
    if (link) return link;
  }
  return null;
}
