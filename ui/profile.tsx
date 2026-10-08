import { ArrowLeft, Ban, Check, Copy, LoaderCircle, MoreVertical, Pencil, Shield, ShieldOff, Timer, UserMinus, UserRoundPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type Chat, type Participant, type ParticipantAction, type ParticipantResult, type Profile } from "./api.ts";
import { Avatar } from "./avatar.tsx";
import { AddParticipantsDialog, GroupInfoDialog } from "./dialogs.tsx";
import { ResizeHandle } from "./resize.tsx";
import { Button, Dialog, Menu, Select } from "./ds/index.ts";

/** Quem está aberto no painel: a própria conversa ou um participante de grupo. */
export type ProfileTarget = { jid: string; name: string; phone: string | null; isGroup: boolean };

const formatPhone = (phone: string) => {
  const m = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${phone}`;
};

/** Prazos de mensagens temporárias que o WhatsApp oferece. */
const EPHEMERAL = [
  { value: "0", label: "Desligadas" },
  { value: "86400", label: "24 horas" },
  { value: "604800", label: "7 dias" },
  { value: "7776000", label: "90 dias" },
];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="compact"
      icon={done ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      aria-label={done ? "Copiado" : label}
      title={done ? "Copiado" : label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    />
  );
}

/** Ação confirmada antes de ir para o WhatsApp (bloquear, remover do grupo). */
type Confirm = { title: string; text: string; action: string; run: () => Promise<void> };

/** Painel lateral com foto, número, recado e, em grupo, descrição e participantes. */
export function ProfilePanel({ target, chat, connected, onClose, onChat, notify }: {
  target: ProfileTarget;
  /** Conversa aberta: temporárias valem para ela. */
  chat: Chat;
  connected: boolean;
  onClose: () => void;
  onChat: (chat: Chat) => void;
  notify: (kind: "error" | "success", text: string) => void;
}) {
  // Pilha: do grupo dá para abrir um participante e voltar.
  const [stack, setStack] = useState<ProfileTarget[]>([target]);
  const current = stack[stack.length - 1];
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<"subject" | "description" | null>(null);
  const [adding, setAdding] = useState(false);
  const [savingEphemeral, setSavingEphemeral] = useState(false);

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
  }, [current.jid, connected, reloadSeq]);

  const reload = useCallback(() => setReloadSeq((n) => n + 1), []);
  const open = (p: Participant) => !p.me && setStack((s) => [...s, { jid: p.jid, name: p.name, phone: p.phone, isGroup: false }]);
  const group = profile?.group ?? null;
  const isChat = current.jid === chat.jid;
  const canEditInfo = !!group && (group.meAdmin || !group.restrict);

  /** Resultado de cada participante: avisa quem o WhatsApp recusou e o motivo. */
  const report = (results: ParticipantResult[], done: string) => {
    const failed = results.filter((r) => !r.ok);
    if (!failed.length) return notify("success", done);
    const names = (jid: string) => group?.participants.find((p) => p.jid === jid)?.name ?? `+${jid.split("@")[0]}`;
    notify("error", failed.map((r) => `${names(r.jid)}: ${r.reason}`).join(" · "));
  };

  const changeParticipants = async (action: ParticipantAction, jids: string[], done: string) => {
    const results = await api.updateParticipants(chat.jid, action, jids);
    report(results, done);
    reload();
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      setConfirm(null);
    } catch (e) {
      notify("error", `${confirm.action} não deu certo. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const block = (blocked: boolean) =>
    setConfirm({
      title: blocked ? `Bloquear ${current.name}?` : `Desbloquear ${current.name}?`,
      text: blocked
        ? "O contato não vai mais conseguir ligar nem mandar mensagens para este número. Ele não é avisado."
        : "O contato volta a poder ligar e mandar mensagens para este número.",
      action: blocked ? "Bloquear" : "Desbloquear",
      run: async () => {
        await api.setBlocked(current.jid, blocked);
        setProfile((p) => (p ? { ...p, blocked } : p));
        notify("success", blocked ? `${current.name} bloqueado.` : `${current.name} desbloqueado.`);
      },
    });

  const setEphemeral = async (value: string | null) => {
    const seconds = Number(value ?? 0);
    if ((chat.ephemeral ?? 0) === seconds) return;
    setSavingEphemeral(true);
    try {
      onChat(await api.setEphemeral(chat.jid, seconds));
      notify("success", seconds ? "Mensagens temporárias ligadas para todos da conversa." : "Mensagens temporárias desligadas.");
    } catch (e) {
      notify("error", `Não foi possível mudar as mensagens temporárias. ${(e as Error).message}`);
    } finally {
      setSavingEphemeral(false);
    }
  };

  return (
    <aside className="notes profile" aria-label={`Perfil de ${current.name}`}>
      <ResizeHandle cssVar="--inbox-side-w" storageKey="inbox:side-w" initial={320} min={280} max={560} edge="start" reserve={360} label="Largura do painel lateral" />
      <header className="notes__header">
        <div className="cluster">
          {stack.length > 1 && (
            <Button variant="ghost" size="compact" icon={<ArrowLeft size={16} aria-hidden />} aria-label="Voltar ao grupo" onClick={() => setStack((s) => s.slice(0, -1))} />
          )}
          <h3 className="eyebrow">{current.isGroup ? "Dados do grupo" : "Dados do contato"}</h3>
        </div>
        <Button variant="ghost" size="compact" icon={<X size={16} aria-hidden />} aria-label="Fechar perfil" onClick={onClose} />
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
            {profile?.blocked && (
              <span className="badge badge--danger">
                <Ban size={12} aria-hidden /> Bloqueado
              </span>
            )}
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

        {isChat && (
          <section className="stack profile__section">
            <h5 className="eyebrow">
              <Timer size={14} aria-hidden /> Mensagens temporárias
            </h5>
            <Select
              aria-label="Mensagens temporárias"
              size="compact"
              clearable={false}
              searchable={false}
              disabled={!connected || savingEphemeral || (!!group && group.restrict && !group.meAdmin)}
              value={String(chat.ephemeral ?? 0)}
              onChange={(v) => void setEphemeral(v)}
              options={EPHEMERAL}
            />
            <span className="hint">
              {group && group.restrict && !group.meAdmin
                ? "Só admins mudam esta opção neste grupo."
                : "Vale para todos da conversa: as novas mensagens somem depois do prazo. O histórico deste computador fica guardado."}
            </span>
          </section>
        )}

        {group && (
          <>
            <section className="stack profile__section">
              <div className="profile__section-head">
                <h5 className="eyebrow">Descrição</h5>
                {canEditInfo && connected && (
                  <div className="cluster">
                    <Button variant="ghost" size="compact" icon={<Pencil size={14} aria-hidden />} onClick={() => setEditing("subject")}>
                      Nome
                    </Button>
                    <Button variant="ghost" size="compact" icon={<Pencil size={14} aria-hidden />} onClick={() => setEditing("description")}>
                      Descrição
                    </Button>
                  </div>
                )}
              </div>
              <p className="profile__text">{group.description ?? "Sem descrição."}</p>
              {group.createdAt && <span className="hint">Criado em {new Date(group.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>}
            </section>
            <section className="stack profile__section">
              <div className="profile__section-head">
                <h5 className="eyebrow">
                  <Users size={14} aria-hidden /> Participantes
                </h5>
                {group.meAdmin && connected && (
                  <Button variant="secondary" size="compact" icon={<UserRoundPlus size={14} aria-hidden />} onClick={() => setAdding(true)}>
                    Adicionar
                  </Button>
                )}
              </div>
              <ul className="participants">
                {group.participants.map((p) => (
                  <li key={p.jid} className="participants__row">
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
                    {group.meAdmin && connected && !p.me && (
                      <Menu
                        trigger={(t) => <Button {...t} variant="ghost" size="compact" aria-label={`Ações para ${p.name}`} icon={<MoreVertical size={16} aria-hidden />} />}
                        actions={[
                          p.admin
                            ? { id: "demote", label: "Remover de admin", icon: <ShieldOff size={16} aria-hidden />, onSelect: () => void changeParticipants("demote", [p.jid], `${p.name} não é mais admin.`).catch((e: Error) => notify("error", e.message)) }
                            : { id: "promote", label: "Tornar admin", icon: <Shield size={16} aria-hidden />, onSelect: () => void changeParticipants("promote", [p.jid], `${p.name} agora é admin.`).catch((e: Error) => notify("error", e.message)) },
                          {
                            id: "remove",
                            label: "Remover do grupo",
                            tone: "danger",
                            icon: <UserMinus size={16} aria-hidden />,
                            onSelect: () =>
                              setConfirm({
                                title: `Remover ${p.name} do grupo?`,
                                text: "A pessoa deixa de receber as mensagens do grupo. Todos veem o aviso de remoção.",
                                action: "Remover",
                                run: () => changeParticipants("remove", [p.jid], `${p.name} removido do grupo.`),
                              }),
                          },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {profile && !current.isGroup && connected && (
          <section className="stack profile__section">
            <Button variant={profile.blocked ? "secondary" : "danger"} icon={<Ban size={16} aria-hidden />} onClick={() => block(!profile.blocked)}>
              {profile.blocked ? "Desbloquear contato" : "Bloquear contato"}
            </Button>
          </section>
        )}
      </div>
      <Dialog
        open={!!confirm}
        tone="danger"
        onClose={() => !busy && setConfirm(null)}
        title={confirm?.title ?? ""}
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void runConfirm()}>
              {confirm?.action}
            </Button>
          </>
        }
      >
        {confirm?.text}
      </Dialog>
      {editing && group && (
        <GroupInfoDialog
          field={editing}
          current={editing === "subject" ? group.subject : (group.description ?? "")}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            onChat(await api.updateGroupInfo(chat.jid, editing === "subject" ? { subject: value } : { description: value }));
            notify("success", editing === "subject" ? "Nome do grupo atualizado." : "Descrição do grupo atualizada.");
            reload();
          }}
        />
      )}
      {adding && group && (
        <AddParticipantsDialog
          groupName={group.subject}
          exclude={group.participants.map((p) => p.jid)}
          onClose={() => setAdding(false)}
          onAdd={(jids) => changeParticipants("add", jids, jids.length > 1 ? `${jids.length} pessoas adicionadas.` : "Pessoa adicionada.")}
        />
      )}
    </aside>
  );
}
