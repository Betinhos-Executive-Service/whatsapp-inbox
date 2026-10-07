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

/** Foto de perfil com as iniciais por baixo: sem foto, privada ou offline, ficam as iniciais. */
export const Avatar = memo(function Avatar({ jid, name, className = "", full = false }: { jid: string | null; name: string; className?: string; full?: boolean }) {
  const v = useSyncExternalStore(subscribe, () => version);
  const [loaded, setLoaded] = useState<string | null>(null);
  const src = jid ? photoUrl(jid, full, v) : null;
  const show = !!jid && !!src && !missing.has(jid);
  return (
    <span className={`avatar ${className}`} aria-hidden>
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
    </span>
  );
});
