import { ArrowLeft, Check, Copy, LoaderCircle, Shield, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Participant, type Profile } from "./api.ts";
import { Avatar } from "./avatar.tsx";
import { ResizeHandle } from "./resize.tsx";

/** Quem está aberto no painel: a própria conversa ou um participante de grupo. */
export type ProfileTarget = { jid: string; name: string; phone: string | null; isGroup: boolean };

const formatPhone = (phone: string) => {
  const m = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${phone}`;
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-button icon-button--plain"
      aria-label={done ? "Copiado" : label}
      title={done ? "Copiado" : label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
    </button>
  );
}

/** Painel lateral com foto, número, recado e, em grupo, descrição e participantes. */
export function ProfilePanel({ target, connected, onClose }: { target: ProfileTarget; connected: boolean; onClose: () => void }) {
  // Pilha: do grupo dá para abrir um participante e voltar.
  const [stack, setStack] = useState<ProfileTarget[]>([target]);
  const current = stack[stack.length - 1];
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setStack([target]), [target.jid]);

  useEffect(() => {
    let alive = true;
    setProfile(null);
    setError(null);
    if (!connected) {
      setError("Conecte o WhatsApp para ver recado e participantes.");
      return;
    }
    setLoading(true);
    api
      .profile(current.jid)
      .then((p) => alive && setProfile(p))
      .catch((e: Error) => alive && setError(`Não foi possível carregar o perfil. ${e.message}`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [current.jid, connected]);

  const open = (p: Participant) => !p.me && setStack((s) => [...s, { jid: p.jid, name: p.name, phone: p.phone, isGroup: false }]);
  const group = profile?.group ?? null;

  return (
    <aside className="notes profile" aria-label={`Perfil de ${current.name}`}>
      <ResizeHandle cssVar="--inbox-side-w" storageKey="inbox:side-w" initial={320} min={280} max={560} edge="start" reserve={360} label="Largura do painel lateral" />
      <header className="notes__header">
        <div className="cluster">
          {stack.length > 1 && (
            <button type="button" className="icon-button icon-button--plain" aria-label="Voltar ao grupo" onClick={() => setStack((s) => s.slice(0, -1))}>
              <ArrowLeft size={16} aria-hidden />
            </button>
          )}
          <h3 className="eyebrow">{current.isGroup ? "Dados do grupo" : "Dados do contato"}</h3>
        </div>
        <button type="button" className="icon-button icon-button--plain" aria-label="Fechar perfil" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </header>
      <div className="notes__body">
        <div className="profile__hero">
          <Avatar jid={current.jid} name={current.name} className="avatar--xl" full />
          <div className="profile__id">
            <h4 className="heading-card profile__name">{group?.subject ?? current.name}</h4>
            {current.phone && (
              <div className="profile__phone">
                <span>{formatPhone(current.phone)}</span>
                <CopyButton text={`+${current.phone}`} label="Copiar número" />
              </div>
            )}
            {current.isGroup && group && <span className="hint">Grupo · {group.size} participantes</span>}
          </div>
        </div>

        {loading && (
          <p className="hint profile__status">
            <LoaderCircle className="spin" size={14} aria-hidden /> Carregando…
          </p>
        )}
        {error && <p className="hint hint--warning">{error}</p>}

        {profile && !current.isGroup && (
          <section className="stack profile__section">
            <h5 className="eyebrow">Recado</h5>
            <p className="profile__text">{profile.about ?? "Sem recado ou recado privado."}</p>
            {profile.aboutAt && <span className="hint">Atualizado em {new Date(profile.aboutAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>}
          </section>
        )}

        {group && (
          <>
            <section className="stack profile__section">
              <h5 className="eyebrow">Descrição</h5>
              <p className="profile__text">{group.description ?? "Sem descrição."}</p>
              {group.createdAt && <span className="hint">Criado em {new Date(group.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>}
            </section>
            <section className="stack profile__section">
              <h5 className="eyebrow">
                <Users size={14} aria-hidden /> Participantes
              </h5>
              <ul className="participants">
                {group.participants.map((p) => (
                  <li key={p.jid}>
                    <button type="button" className="participant" onClick={() => open(p)} disabled={p.me}>
                      <Avatar jid={p.jid} name={p.name} className="avatar--sm" />
                      <span className="participant__info">
                        <span className="participant__name">{p.name}</span>
                        {p.phone && p.name !== `+${p.phone}` && <span className="hint">{formatPhone(p.phone)}</span>}
                      </span>
                      {p.admin && (
                        <span className="badge badge--info">
                          <Shield size={12} aria-hidden /> Admin
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
