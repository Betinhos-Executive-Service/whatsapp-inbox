// Trilho de contas: lista as contas, troca a conta ativa e desenha o selo da barra de tarefas.
import { BADGE_FONT, badgeImage } from "../../ui/badge.ts";

export type RailAccount = {
  id: string;
  name: string;
  active: boolean;
  unread: number;
  status: "ok" | "wait" | "qr" | "error";
  statusText: string;
};

type RailBridge = {
  onState: (cb: (accounts: RailAccount[]) => void) => void;
  select: (id: string) => void;
  menu: (id: string) => void;
  add: () => void;
};

declare global {
  interface Window {
    rail: RailBridge;
    railBadge: (total: number) => Promise<string>;
  }
}

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

const STATUS_LABEL: Record<RailAccount["status"], string> = { ok: "", wait: "", qr: "QR", error: "!" };

function render(accounts: RailAccount[]) {
  const list = document.getElementById("accounts")!;
  list.replaceChildren(
    ...accounts.map((a, i) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "account";
      button.textContent = initials(a.name);
      button.setAttribute("aria-current", String(a.active));
      const unread = a.unread > 0 ? `, ${a.unread} não lidas` : "";
      const shortcut = i < 9 ? ` (Ctrl+${i + 1})` : "";
      button.title = `${a.name} · ${a.statusText}${unread}${shortcut}`;
      button.setAttribute("aria-label", `${a.name}, ${a.statusText}${unread}`);
      button.addEventListener("click", () => window.rail.select(a.id));
      button.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        window.rail.menu(a.id);
      });
      if (a.unread > 0) {
        const badge = document.createElement("span");
        badge.className = "account__unread";
        badge.textContent = a.unread > 99 ? "99+" : String(a.unread);
        badge.setAttribute("aria-hidden", "true");
        button.append(badge);
      }
      const status = document.createElement("span");
      status.className = `account__status account__status--${a.status}`;
      status.textContent = STATUS_LABEL[a.status];
      status.setAttribute("aria-hidden", "true");
      button.append(status);
      li.append(button);
      return li;
    }),
  );
}

window.rail.onState(render);
document.getElementById("add")!.addEventListener("click", () => window.rail.add());

/** Selo com o total de todas as contas, pedido pelo processo principal. */
window.railBadge = async (total: number) => {
  await document.fonts.load(BADGE_FONT).catch(() => undefined);
  return badgeImage(total);
};
