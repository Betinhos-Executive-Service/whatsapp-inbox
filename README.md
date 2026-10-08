# WhatsApp Inbox

Inbox local e leve para gerir e classificar as conversas do seu WhatsApp. Roda no seu PC, sem Docker e sem banco externo.

- **Conversas por status:** Abertas, Aguardando e Resolvidas. Mensagem nova reabre a conversa; resposta sua passa para Aguardando.
- **Etiquetas** editáveis (Cotação, Reserva, Operação…): a principal vem da IA ou de você; dá para somar etiquetas extras.
- **Responder** pelo próprio app: texto, anexos e mensagem de voz, citando, mencionando com @ e com formatação do WhatsApp. Ticks de entrega/leitura, reações, editar (até 15 min), apagar e encaminhar.
- **Mais que texto:** enquete (criar, votar e ver quem votou), localização (link do mapa ou coordenadas), contato, figurinhas já recebidas e prévia de link ao enviar URL. Chegam legíveis também evento, convite de grupo (com **Entrar no grupo**), ligações (recebida, perdida, atendida no celular) e avisos do grupo (entrou, saiu, mudou o nome).
- **Como no WhatsApp:** nova conversa por número, marcar como não lida, favoritar mensagens (lista de favoritas no topo), fixar mensagem por 24 h, 7 ou 30 dias, responder em particular a quem escreveu no grupo, bloquear contato e mensagens temporárias.
- **Grupos:** criar grupo, adicionar e remover pessoas, tornar ou tirar admin e mudar nome e descrição (pelo perfil do grupo, se você for admin).
- **Organizar:** fixar no topo, arquivar, silenciar notificações e adiar (some das abertas e volta sozinha na hora marcada). Rascunho guardado por conversa.
- **Busca** em nomes, números e no texto de todo o histórico, sem acento; o resultado abre a conversa na mensagem.
- **Atalhos:** `Ctrl+K` busca, `Alt+↓/↑` próxima/anterior conversa, `Ctrl+Enter` resolve, `?` mostra todos.
- Conversas individuais e grupos; status, canais e comunidades ficam de fora. Ligações são atendidas no celular (o app só avisa), e mídia de visualização única só abre no celular.

## Instalar e usar

Baixe o instalador `WhatsApp Inbox Setup <versão>.exe` em [Releases](https://github.com/Betinhos-Executive-Service/whatsapp-inbox/releases/latest) e abra. O app instala sozinho (sem pedir administrador), cria atalho na área de trabalho e abre.

Na primeira vez, leia o código QR pelo celular (WhatsApp › Aparelhos conectados › Conectar aparelho). A sessão fica salva.

- Fechar a janela deixa o app na **bandeja** (perto do relógio), recebendo mensagens e classificando. Para sair, clique com o botão direito no ícone › **Sair**.
- No mesmo menu: **Iniciar com o Windows**.
- **Atualização:** o app verifica a cada 2 minutos e, quando sai versão nova no GitHub, mostra uma vez um aviso no canto com o que mudou em linguagem simples (e o botão **Ver versões** para o histórico). **Atualizar agora** baixa, fecha por alguns segundos e reabre na versão nova. As conversas e a conexão continuam.

O Windows pode mostrar "O Windows protegeu o computador" na primeira instalação, porque o instalador não tem assinatura digital paga. Clique em **Mais informações › Executar assim mesmo**.

## Classificação (Jev ou DeepSeek)

Em **Configurações › IA**, escolha quem classifica: **Jev** (chave do Jev, ou `JEV_API_KEY` em `.env.local`) ou **DeepSeek** (mesma chave usada em rascunho e resumo, ou `DEEPSEEK_API_KEY`). Sem chave do escolhido, o app usa o outro que tiver chave.

Cada classificação devolve etiqueta, se a conversa espera resposta, urgência e **prioridade** (alta, média ou baixa) pensada para o número de gestão: serviço em andamento com problema, cobrança vencida ou decisão só da gestão é alta; cotação, reserva ou aprovação com prazo nos próximos dias é média; aviso, agradecimento ou assunto resolvido é baixa. A DeepSeek ainda explica o motivo em uma frase. A prioridade aparece na lista e manda na ordem **Responder primeiro**.

Com a classificação automática ligada, cada conversa que recebe mensagem é classificada 15 s depois da última mensagem da rajada. A IA recebe o nome do contato e o texto das últimas 30 mensagens, sem identificadores do WhatsApp. Etiqueta escolhida à mão nunca é sobrescrita.

## Claude Code (servidor MCP)

Em **Configurações › IA › Claude Code**, clique em **Conectar**: o app registra um servidor MCP (`whatsapp-inbox`, escopo do usuário) no Claude Code deste PC. Nas sessões do Claude você passa a ter `listar_conversas`, `ler_mensagens`, `buscar_mensagens`, `ler_midia` (áudio vira transcrição, imagem vem como imagem), `perfil_contato`, `marcar_lida`, `atualizar_conversa`, `abrir_conversa`, `propor_resposta` e `propor_midia`.

O Claude nunca envia: `propor_*` cria um **rascunho pendente** na conversa, que aparece no composer com **Enviar**, **Editar** e **Descartar**. O processo MCP fala com o app pela API local (`x-inbox-token`); o app grava porta e token da execução em `mcp.json` (pasta de dados; em dev `data/mcp.json`), então o Inbox precisa estar aberto. Reinicie as sessões do Claude Code depois de conectar. Em desenvolvimento, o comando registrado é `node server/mcp-main.ts`; no app instalado é o próprio executável em modo Node com `dist-electron/mcp.mjs`.

## Dados

No app instalado, tudo fica em `%APPDATA%\WhatsApp Inbox\data` (no modo de desenvolvimento, em `data/` do projeto):

- `inbox.db`: conversas, mensagens, etiquetas e configurações (SQLite);
- `auth/`: sessão do WhatsApp. Apagar a pasta desconecta o PC.

Desinstalar o app não apaga essa pasta.

O servidor só escuta em `127.0.0.1` e recusa pedidos de outras origens.

## Desenvolvimento

```bash
pnpm dev        # navegador: http://127.0.0.1:38291, recompila a cada mudança
pnpm app        # abre o app desktop sem instalar
pnpm exe        # gera o instalador em release/ sem publicar
pnpm release    # usado pelo workflow da main; não rodar à mão
pnpm test       # testes (node --test)
pnpm typecheck
```

A versão é automática: cada alteração na `main` dispara o workflow `release` (GitHub Actions), que incrementa a versão, faz o commit `release: vX`, gera o instalador e publica a release; os apps instalados passam a avisar da versão nova. Não rode `pnpm release` à mão, senão a versão sobe duas vezes.

Feche o app instalado antes de rodar `pnpm dev` ou `pnpm app` com a mesma sessão: dois clientes com a mesma sessão derrubam um ao outro.

Pilha: Electron 44 (Node 24, `node:sqlite`), Baileys (protocolo multi-device do WhatsApp), React + esbuild, Design System Betinhos 1.4.0.

**Risco:** Baileys é um cliente não oficial do WhatsApp. Há risco de restrição da conta, principalmente com envios em massa. Use para atender as suas conversas, não para disparos.
