// Arrastar arquivo do computador para o app: estado global do arraste, "abrir ao parar em cima"
// (como as pastas do Explorer), rolagem automática da lista e a bandeja de anexos de cada conversa.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Attachment } from "./media.tsx";

/** Tempo parado sobre uma conversa, aba ou botão até ele abrir sozinho. */
export const SPRING_DELAY = 700;

export const hasFiles = (dt: DataTransfer | null): boolean => !!dt && Array.from(dt.types).includes("Files");

// ---- Há arquivo sendo arrastado sobre a janela?

let dragging = false;
let watchdog = 0;
const dragListeners = new Set<() => void>();
function setDragging(value: boolean) {
  window.clearTimeout(watchdog);
  // O navegador repete o dragover enquanto o arquivo está sobre a janela, mesmo parado; se ele
  // some (saiu da janela, Esc, soltou fora), o arraste acabou.
  if (value) watchdog = window.setTimeout(() => setDragging(false), 1200);
  if (dragging === value) return;
  dragging = value;
  dragListeners.forEach((fn) => fn());
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  window.addEventListener("dragenter", (e) => hasFiles(e.dataTransfer) && setDragging(true));
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    setDragging(true);
    // Fora de uma área que aceita o arquivo, o navegador o abriria no lugar do app.
    if (!e.defaultPrevented) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "none";
    }
  });
  window.addEventListener("dragleave", (e) => {
    // Saiu pela borda da janela (o relatedTarget nem sempre vem preenchido).
    if (!e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight)) setDragging(false);
  });
  window.addEventListener("drop", (e) => {
    if (hasFiles(e.dataTransfer)) e.preventDefault();
  });
  window.addEventListener("drop", () => setDragging(false), true);
  window.addEventListener("dragend", () => setDragging(false), true);
}

/** true enquanto um arquivo do computador está sendo arrastado sobre a janela. */
export function useFileDrag(): boolean {
  return useSyncExternalStore(
    useCallback((fn: () => void) => {
      install();
      dragListeners.add(fn);
      return () => void dragListeners.delete(fn);
    }, []),
    () => dragging,
  );
}

// ---- Abrir ao parar em cima

const spring: { el: HTMLElement | null; timer: number } = { el: null, timer: 0 };

/**
 * Elemento com `data-spring` sob o arquivo arrastado: depois de SPRING_DELAY parado ali, recebe um
 * clique (abre a conversa, troca a aba, volta para a lista). Enquanto conta, ganha `data-spring-armed`
 * (o CSS mostra o progresso). Chamar com o elemento a cada dragover; null quando não há nenhum.
 */
export function useSpringLoad(active: boolean) {
  const hover = useCallback(
    (el: HTMLElement | null) => {
      const s = spring;
      if (el === s.el) return;
      window.clearTimeout(s.timer);
      s.el?.removeAttribute("data-spring-armed");
      s.el = el;
      if (!el) return;
      el.setAttribute("data-spring-armed", "");
      s.timer = window.setTimeout(() => {
        el.removeAttribute("data-spring-armed");
        // Fica como "atual" até o arquivo sair dele: não abre de novo a cada dragover.
        if (el.isConnected) el.click();
      }, SPRING_DELAY);
    },
    [],
  );
  useEffect(() => {
    if (!active) hover(null);
  }, [active, hover]);
  useEffect(() => () => hover(null), [hover]);
  return hover;
}

/** Rola a área com `data-drag-scroll` quando o arquivo chega perto da borda de cima ou de baixo. */
export function dragAutoScroll(target: Element | null, clientY: number) {
  const box = target?.closest<HTMLElement>("[data-drag-scroll]");
  if (!box) return;
  const EDGE = 56;
  const rect = box.getBoundingClientRect();
  const top = clientY - rect.top;
  const bottom = rect.bottom - clientY;
  if (top < EDGE) box.scrollTop -= Math.ceil((EDGE - top) / 3);
  else if (bottom < EDGE) box.scrollTop += Math.ceil((EDGE - bottom) / 3);
}

// ---- Bandeja de anexos de cada conversa

/**
 * Anexos ainda não enviados ficam guardados ao trocar de conversa (vale enquanto o app estiver aberto),
 * como o rascunho do texto: passar por outra conversa arrastando um arquivo não perde o que já estava ali.
 */
const trays = new Map<string, Attachment[]>();
const trayListeners = new Map<string, Set<() => void>>();
const notifyTray = (jid: string) => trayListeners.get(jid)?.forEach((fn) => fn());
export const tray = {
  get: (jid: string): Attachment[] => trays.get(jid) ?? EMPTY,
  set(jid: string, list: Attachment[]) {
    if (list.length) trays.set(jid, list);
    else if (!trays.delete(jid)) return;
    notifyTray(jid);
  },
};
const EMPTY: Attachment[] = [];

/** Quantos anexos esperam envio numa conversa que não está aberta. */
export function useTrayCount(jid: string): number {
  return useSyncExternalStore(
    useCallback(
      (fn: () => void) => {
        let set = trayListeners.get(jid);
        if (!set) trayListeners.set(jid, (set = new Set()));
        set.add(fn);
        return () => {
          set.delete(fn);
          if (!set.size) trayListeners.delete(jid);
        };
      },
      [jid],
    ),
    () => trays.get(jid)?.length ?? 0,
  );
}
