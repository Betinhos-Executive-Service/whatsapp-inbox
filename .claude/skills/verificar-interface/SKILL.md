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
7. Configurações (engrenagem) → as 8 seções aparecem em lista lateral à esquerda (em até 640 px sobem para cima do conteúdo e quebram de linha, sem rolagem lateral). Marcar uma opção e clicar fora → "Descartar alterações?" com "Continuar editando" e "Descartar". Esc fecha sem alteração.
8. Mensagem apagada: abrir o Carlos → bolha "Esta mensagem foi apagada" com o botão "Ver mensagem"; clicar → aparece "Na verdade somos 4 pessoas e 5 malas." atenuado e o botão vira "Ocultar". A prévia na lista continua "Mensagem apagada"; duplo clique na bolha não abre resposta.
9. IA no cabeçalho e no campo de resposta: o cabeçalho da conversa tem só "Agendar" (Claude), "Notas" e a lupa; não há seletor de modelo ali. Sem IA configurada (caso do seed), não existe a seta ao lado da varinha e o painel Notas mostra só "Ative a IA em Configurações › IA para usar.", sem o botão "Resumir conversa". Para ver a seta, intercepte `GET /api/ai` e devolva `deepseek.configured: true`: clicar na seta abre o painel "Escolher IA" para cima, inteiro dentro da tela (também em 375 px), e Esc fecha.
10. Console: `read_console_messages` com `onlyErrors` → só os 404 de `/api/photo/...` (contato sem foto, conhecido) são aceitos.
11. Falha de envio (mudou `deliver`, `send`, `mergeTail`, `insertByTime` ou os eventos `inbox:message/update/remove` em `ui/main.tsx`): `PLAYWRIGHT_CORE=<pasta com node_modules/playwright-core> node .claude/skills/verificar-interface/envio-falhas.mjs <saída>` com o servidor no ar. Esperado: sem confirmação do WhatsApp a bolha fica "Não enviada · Tentar de novo · Descartar" (nunca some); confirmação atrasada troca a bolha pela mensagem real; falha com outra conversa aberta dá o toast "Mensagem para <nome> não enviada; o texto voltou para o rascunho." e o texto está no campo ao voltar, sem bolha fantasma; horário corrigido reordena a mensagem.

## Casos de borda
- **Servidor fora do ar** (falha de conexão): com o painel Notas aberto, parar o servidor (`preview_stop` e conferir a porta 38291 livre) e digitar na nota. Esperado: status vermelho "Não salva" (title "Saia do campo para tentar de novo.") sem quebrar o título "Nota interna" em duas linhas, toast "Nota não salva. Sem comunicação com o WhatsApp Inbox. Confira se o app está aberto e tente de novo." (nunca "Failed to fetch"), selo "App desligado" e o texto preservado. Subir o servidor de novo, tirar o foco do campo → status "Salva" e `GET /api/chats` traz a nota.
- **Marcada como não lida com a conversa aberta** (simula o celular): com a Mariana aberta, `fetch('/api/chats/<jid>', {method:'PATCH', body:'{"markedUnread":true}'})` → o ponto azul aparece na linha e a marca continua (`GET /api/chats` traz `markedUnread: true`). Abrir outra conversa e voltar → a marca sai. Marcada antes de abrir → abrir tira a marca.
- **Anexo alterado ou removido depois de anexado** (sem WhatsApp, o composer fica desativado): no Chromium headless, `<input type=file>` com um arquivo de ~15 MB, copiar como em `snapshotFile` (`ui/media.tsx`), depois alterar (`appendFile`) e apagar o arquivo no disco. Esperado: o `File` original falha com `NotReadableError`/`NotFoundError` e a cópia lê todos os bytes. É o erro "The requested file could not be read" ao enviar.
- **Visualizador de imagem e mídias** (sem WhatsApp, use mídia já baixada; ou monte só `ui/media.tsx`/`ui/chat-media.tsx` com esbuild e `/api/chats/*/media` e `/api/media` mockados num Chromium com permissão de clipboard). Esperado: imagem ajustada sem rolagem (`scrollHeight <= clientHeight` no documento e no `.zoomable`); clique na imagem → zoom acima do ajuste no ponto clicado; arrastar move e não fecha; `0` volta ao ajuste; Ctrl+C → "Imagem copiada. Cole com Ctrl+V." e `navigator.clipboard.read()` traz `image/png` (mock em PNG: SVG não copia); na galeria `←` sem zoom troca de foto; Esc fecha só o visualizador e o painel de mídias continua aberto. Painel "Ver tudo" do perfil: meses, remetente em grupo, busca por nome, filtro Enviados e aba Links.
- **Foto de perfil em tela cheia** (sem WhatsApp não há foto: no Playwright, `page.route("**/api/photo/**")` devolvendo uma imagem). Abrir a Mariana → "Ver perfil do contato" → a foto grande vira botão "Ver foto de … em tela cheia" (cursor lupa) → clique abre `[role=dialog]` "Foto de …" com zoom e "Baixar"; Esc, X e clique no fundo fecham. Contato sem foto (rota sem mock, 404) fica só com as iniciais e não é clicável.
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

## Copiar arquivos (menu, álbum e seleção)
- Só aparece com a ponte do app desktop. No Chromium headless, injete um `window.desktop` falso com `addInitScript` (`copyFile`, `copyFiles`, `copyImage`, `warmCopy` gravando as chamadas) e intercepte `GET /api/chats/*/messages*` para pôr `media` em três mensagens (um documento e duas imagens com o mesmo `media.album`) e `GET /api/media/**` devolvendo um PNG.
- Esperado: botão direito na foto do álbum mostra "Copiar imagem", "Copiar como arquivo" e "Copiar álbum (2 arquivos)"; abrir o menu chama `warmCopy`; "Copiar álbum" chama `copyFiles` com os dois ids e o toast "2 arquivos copiados. Cole com Ctrl+V onde quiser."; na seleção com mídia, "Copiar" chama `copyFiles` (com o texto junto quando há legenda ou mensagem de texto).
- A gravação real na área de transferência (Windows: PowerShell que fica aberto, `desktop/clipboard-files.ts`) só se prova no Windows: copiar e conferir com `[Windows.Forms.Clipboard]::GetFileDropList()`. Não entra nos testes automáticos porque troca a área de transferência de quem roda.
