---
name: verificar-interface
description: "Verifica a interface do WhatsApp Inbox no navegador, sem WhatsApp: lista de conversas, busca, status, conversa aberta, Notas e lembretes, Configurações e mensagens de falha de conexão. Use após mudar ui/** ou quando pedirem para testar a tela."
---
# Verificar interface

## Cobre
- Código: `ui/**` (React + CSS do Design System em `ui/ds/`).
- Telas: lista de conversas (busca, abas de status, filtros), conversa aberta (status, etiqueta, composer desativado), painel Notas e lembretes, gaveta Configurações (8 abas), lista de atalhos.

## Preparar ambiente
1. Dados fictícios (pasta `data/` é ignorada pelo Git):
   `node .claude/skills/verificar-interface/seed.ts data`
   Cria 67 conversas: Mariana (Reserva), Carlos (Cotação), João (Motorista, fixada), Financeiro Grupo Vale (Aguardando), Fernanda (Resolvida), um número sem nome, o grupo "Operação Betinhos — Escala" e 60 "Cliente N" resolvidas. Pode rodar de novo: as mensagens têm id fixo e não duplicam.
2. Servidor: `preview_start` com `inbox-dev-sem-whatsapp` (`.claude/launch.json`, porta 38291, `WA_DISABLED=1`). Sem `.env.local`, nenhuma IA é chamada.
3. Use a aba que o `preview_start` abriu. Se um `navigate` for recusado, troque o host (`localhost` ↔ `127.0.0.1`) ou recarregue com `location.reload()`; espere o selo sair de "Iniciando" antes de testar. Viewport `resize_window` 1440×900, `colorScheme: light`.
4. O `pnpm dev` incrementa a versão no `package.json`. Ao terminar: `git checkout -- package.json` (só publicar a versão quando for release).
5. Com viewport emulado, clique por `ref` (`find` → `computer` com `ref`); clique por coordenada erra o alvo.

## Roteiro
1. Lista carrega → selo "Desconectado", abas com contagem (`[role=tab]` com aria-label "Abertas (N)" etc.), 67 em "Todas".
2. Busca por nome: digitar `Carlos` no campo "Buscar conversa" → barra "1 resultado para “Carlos”" e a linha do Carlos.
3. Busca só em mensagem: digitar `guarulhos` → enquanto procura, "Procurando “guarulhos” nas mensagens…"; depois "1 mensagem com “guarulhos”", a linha "Nenhum contato com “guarulhos”. Veja as mensagens encontradas abaixo." e "MENSAGENS (1)" com o trecho da Mariana. **Não** pode aparecer "Nenhuma conversa para…" nem segundo botão "Limpar busca".
4. Busca sem nada: digitar `xyzqw` → estado vazio "Nenhuma conversa para “xyzqw”", botão "Limpar busca" e "Nenhuma mensagem com esse texto."
5. Abrir a Mariana → 3 mensagens, composer com "Conecte o WhatsApp para responder.". Clicar "Resolvida" no cabeçalho → PATCH `/api/chats/<jid>` 200 e contadores mudam (Abertas −1, Resolvidas +1).
6. Notas (botão "Notas e lembretes") → digitar na nota → status "Salvando…" e depois "Salva". Clicar "Em 1 hora" com texto no lembrete → toast "Lembrete criado para Hoje HH:MM." e o lembrete na lista.
7. Configurações (engrenagem) → marcar uma opção e clicar fora → "Descartar alterações?" com "Continuar editando" e "Descartar". Esc fecha sem alteração.
8. Console: `read_console_messages` com `onlyErrors` → só os 404 de `/api/photo/...` (contato sem foto, conhecido) são aceitos.

## Casos de borda
- **Servidor fora do ar** (falha de conexão): com o painel Notas aberto, parar o servidor (`preview_stop` e conferir a porta 38291 livre) e digitar na nota. Esperado: status vermelho "Não salva" (title "Saia do campo para tentar de novo.") sem quebrar o título "Nota interna" em duas linhas, toast "Nota não salva. Sem comunicação com o WhatsApp Inbox. Confira se o app está aberto e tente de novo." (nunca "Failed to fetch"), selo "App desligado" e o texto preservado. Subir o servidor de novo, tirar o foco do campo → status "Salva" e `GET /api/chats` traz a nota.
- Volume: rolar até "Mostrar mais" (60+ conversas).
- Larguras: 1024 (painel Notas sobrepõe a conversa), 768 (Notas em tela cheia), 375.

## Evidência obrigatória
- Screenshot do passo 3 (busca só em mensagem) e do caso "servidor fora do ar".
- Saída do console sem erros além dos 404 de foto.
- Salvar em `.verificacao/<data>-<branch>/`.

## Limites
- Envio, anexos, áudio, reações e "Nova conversa" exigem WhatsApp conectado: não testar aqui (nada pode ser enviado de verdade).
- Botão Claude (Analisar/Agendar) chama o Claude Code e o Dataverse PROD: não clicar.
- A tecla `?` pelo emulador de teclado não chega; para a lista de atalhos, disparar `window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))` e conferir o `<dialog>` "Atalhos de teclado".
- App desktop (bandeja, notificações, atualização) não roda no navegador.
