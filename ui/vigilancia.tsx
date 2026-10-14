import { useEffect, useState } from "react";
import { api, type NivelVigilancia, type ResultadoCiclo, type VigilanciaPatch, type VigilanciaStatus } from "./api.ts";
import { Button, Checkbox, Field, Input, Select, Switch } from "./ds/index.ts";

const NIVEL: Record<NivelVigilancia, string> = { ok: "OK", sem_programacao: "Sem programação", sem_sinal: "Sem sinal", parado: "Carro parado", atraso: "Risco de atraso", atencao: "Atenção" };
const hora = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

type Segredo = { campo: keyof VigilanciaPatch; rotulo: string; salvo: boolean; dica: string };

export function VigilanciaPanel({ notify }: { notify: (kind: "error" | "success", text: string) => void }) {
  const [s, setS] = useState<VigilanciaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [ciclo, setCiclo] = useState<ResultadoCiclo | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    api.vigilancia().then((v) => alive && (setS(v), setCiclo(v.ultimo)), (e: Error) => alive && setFalha(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const salvar = async (patch: VigilanciaPatch, ok = "Vigilância atualizada."): Promise<boolean> => {
    setBusy(true);
    try {
      setS(await api.saveVigilancia(patch));
      notify("success", ok);
      return true;
    } catch (e) {
      notify("error", (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const rodar = async () => {
    setBusy(true);
    try {
      const r = await api.vigilanciaCiclo();
      setCiclo(r);
      setS(await api.vigilancia());
      notify("success", r.ensaio ? "Ciclo de ensaio concluído (nada foi enviado)." : "Ciclo concluído.");
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (falha) return <p className="hint hint--warning">Não foi possível consultar a vigilância. {falha}</p>;
  if (!s) return <p className="hint">Consultando…</p>;

  const segredos: Segredo[] = [
    { campo: "dvEnvironmentUrl", rotulo: "URL do Dataverse (PROD)", salvo: s.segredos.dataverse, dica: "Ex.: https://suaorg.crm2.dynamics.com" },
    { campo: "dvTenantId", rotulo: "Tenant ID", salvo: s.segredos.dataverse, dica: "Diretório do Entra ID" },
    { campo: "dvClientId", rotulo: "Client ID", salvo: s.segredos.dataverse, dica: "App registration com application user só de leitura" },
    { campo: "dvClientSecret", rotulo: "Client Secret", salvo: s.segredos.dataverse, dica: "Fica só neste PC" },
    { campo: "infleetToken", rotulo: "Token da Infleet", salvo: s.segredos.infleet, dica: "Mesmo token do infleet-mcp" },
    { campo: "tomtomKey", rotulo: "Chave da TomTom (opcional)", salvo: s.segredos.tomtom, dica: "Rota com trânsito; sem ela usa OSRM, sem trânsito" },
  ];
  const limpar = (campo: string) => setValores((v) => {
    const { [campo]: _, ...resto } = v;
    return resto;
  });
  const num = (campo: "margemMin" | "janelaMin" | "cadenciaMin", rotulo: string, dica: string, min: number, max: number) => (
    <Field label={rotulo} hint={dica}>
      <Input type="number" min={min} max={max} disabled={busy} value={valores[campo] ?? String(s[campo])} onChange={(e) => setValores((v) => ({ ...v, [campo]: e.target.value }))} onBlur={() => {
        if (valores[campo] === undefined) return;
        const v = Number(valores[campo]);
        if (valores[campo].trim() === "" || !Number.isFinite(v) || v < min || v > max) {
          limpar(campo);
          notify("error", `${rotulo}: informe um valor entre ${min} e ${max}.`);
          return;
        }
        const n = Math.round(v);
        if (n === s[campo]) return limpar(campo);
        void salvar({ [campo]: n }).then(() => limpar(campo));
      }} />
    </Field>
  );

  return (
    <div className="stack">
      <p className="hint">
        A cada poucos minutos cruza as OS das próximas horas (Dataverse) com a posição dos carros (Infleet) e o tempo de trajeto com trânsito, e avisa o grupo da operação só quando uma OS entra em risco de atraso ou muda de situação. Roda enquanto o Inbox estiver aberto ou na bandeja.
      </p>
      {s.faltando.length > 0 && <p className="hint hint--warning">Falta configurar: {s.faltando.join(", ")}.</p>}
      {!s.segredos.anthropic && <p className="hint hint--warning">Sem chave da API da Anthropic (aba IA): os avisos saem no formato fixo, sem redação do Claude.</p>}
      <Switch checked={s.ativa} disabled={busy || (!s.ativa && s.faltando.length > 0)} onChange={(e) => void salvar({ ativa: e.target.checked }, e.target.checked ? "Vigilância ligada." : "Vigilância desligada.")} label="Vigilância ligada" />
      <Field label="Grupo do WhatsApp" hint="Grupo interno da operação que recebe os avisos.">
        <Select options={s.grupos.map((g) => ({ value: g.jid, label: g.name }))} value={s.grupoJid} placeholder="Escolha um grupo…" disabled={busy} searchable={s.grupos.length > 8} onChange={(v) => void salvar({ grupoJid: v })} />
      </Field>
      <div className="cluster">
        {num("margemMin", "Margem (min)", "Folga mínima antes do horário de saída.", 1, 120)}
        {num("janelaMin", "Janela (min)", "Quantos minutos à frente as OS entram na vigilância.", 30, 360)}
        {num("cadenciaMin", "Cadência (min)", "Intervalo entre ciclos.", 1, 30)}
      </div>
      <Checkbox checked={s.ensaio} disabled={busy} onChange={(e) => void salvar({ ensaio: e.target.checked })} label="Modo ensaio (mostra aqui o que seria enviado e não manda nada)" />
      <h4 className="eyebrow">Acessos</h4>
      {segredos.map((seg) => (
        <Field key={seg.campo} label={seg.rotulo} hint={`${seg.dica}. ${seg.salvo ? "Configurado." : "Não configurado."}`}>
          <div className="cluster">
            <Input type={seg.campo === "dvEnvironmentUrl" ? "url" : "password"} autoComplete="off" value={valores[seg.campo] ?? ""} disabled={busy} onChange={(e) => setValores((v) => ({ ...v, [seg.campo]: e.target.value }))} placeholder={seg.salvo ? "••••••••" : ""} />
            <Button variant="secondary" size="compact" loading={busy} disabled={!valores[seg.campo]} onClick={() => void salvar({ [seg.campo]: valores[seg.campo] }, `${seg.rotulo} salvo.`).then((ok) => ok && limpar(seg.campo))}>
              Salvar
            </Button>
            {seg.salvo && (
              <Button variant="ghost" size="compact" disabled={busy} onClick={() => void salvar({ [seg.campo]: null }, `${seg.rotulo} removido.`)}>
                Remover
              </Button>
            )}
          </div>
        </Field>
      ))}
      <div className="cluster">
        <Button variant="action" size="compact" loading={busy} disabled={s.faltando.length > 0} onClick={() => void rodar()}>
          Rodar um ciclo agora
        </Button>
        {s.emExecucao && <span className="badge badge--info">Em execução</span>}
      </div>
      {ciclo && (
        <div className="stack">
          <p className="hint">
            Ciclo das {hora(ciclo.em)}{ciclo.ensaio ? " (ensaio)" : ""}: {ciclo.avaliadas.length} OS avaliadas, {ciclo.enviadas.length} avisos{ciclo.erros.length ? `, ${ciclo.erros.length} erros` : ""}.
          </p>
          {ciclo.avaliadas.map((a) => (
            <p key={a.osId} className="hint">
              {a.os}: {NIVEL[a.nivel]}{a.anterior && a.anterior !== a.nivel ? ` (antes: ${NIVEL[a.anterior]})` : ""}{a.folgaMin !== null ? ` · folga ${a.folgaMin} min` : ""}{a.embarqueLocalizado ? "" : " · embarque não localizado"}{a.posicaoConhecida ? "" : " · sem posição"}
            </p>
          ))}
          {ciclo.enviadas.map((e, i) => (
            <pre key={i} className="mcp-command">{e.texto}</pre>
          ))}
          {ciclo.erros.map((e, i) => (
            <p key={i} className="hint hint--warning">{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}
