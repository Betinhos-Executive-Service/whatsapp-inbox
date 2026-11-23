import { memo, useState, useSyncExternalStore } from "react";
import { photoUrl } from "./api.ts";
import { initials } from "./format.ts";

// Quem não tem foto (ou não carregou) fica com as iniciais e não pede de novo até o WhatsApp
// reconectar: aí `refreshAvatars` troca a versão e as fotos que faltavam são buscadas outra vez.
const missing = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

export function refreshAvatars() {
  missing.clear();
  version++;
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/**
 * Foto de perfil com as iniciais por baixo: sem foto, privada ou offline, ficam as iniciais.
 * Com `onOpen`, a foto carregada vira botão (abre em tela cheia); só iniciais continua inerte.
 */
export const Avatar = memo(function Avatar({ jid, name, className = "", full = false, onOpen }: { jid: string | null; name: string; className?: string; full?: boolean; onOpen?: (src: string) => void }) {
  const v = useSyncExternalStore(subscribe, () => version);
  const [loaded, setLoaded] = useState<string | null>(null);
  const src = jid ? photoUrl(jid, full, v) : null;
  const show = !!jid && !!src && !missing.has(jid);
  const content = (
    <>
      {initials(name)}
      {show && (
        <img
          key={src}
          className="avatar__img"
          data-loaded={loaded === src || undefined}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(src)}
          onError={() => {
            missing.add(jid);
            setLoaded(null);
          }}
        />
      )}
    </>
  );
  if (onOpen && src && show && loaded === src)
    return (
      <button type="button" className={`avatar avatar--button ${className}`} aria-label={`Ver foto de ${name} em tela cheia`} title="Ver foto" onClick={() => onOpen(src)}>
        {content}
      </button>
    );
  return (
    <span className={`avatar ${className}`} aria-hidden>
      {content}
    </span>
  );
});
