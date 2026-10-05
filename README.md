# WhatsApp Inbox

Inbox local e leve para gerir e classificar as conversas do seu WhatsApp. Roda no seu PC, sem Docker e sem banco externo.

- **Conversas por status:** Abertas, Aguardando e Resolvidas. Mensagem nova reabre a conversa; resposta sua passa para Aguardando.
- **Etiquetas** editáveis (Cotação, Reserva, Operação…), escolhidas por você ou sugeridas pelo **Jev**.
- **Responder** pelo próprio app (texto). Mídia aparece como `[Imagem]`, `[Áudio]` etc.
- Só conversas individuais: grupos, status e canais ficam de fora.

## Instalar e usar

Baixe o instalador `WhatsApp Inbox Setup <versão>.exe` em [Releases](https://github.com/Betinhos-Executive-Service/whatsapp-inbox/releases/latest) e abra. O app instala sozinho (sem pedir administrador), cria atalho na área de trabalho e abre.

Na primeira vez, leia o código QR pelo celular (WhatsApp › Aparelhos conectados › Conectar aparelho). A sessão fica salva.

- Fechar a janela deixa o app na **bandeja** (perto do relógio), recebendo mensagens e classificando. Para sair, clique com o botão direito no ícone › **Sair**.
- No mesmo menu: **Iniciar com o Windows**.
- **Atualização:** quando sai versão nova no GitHub, o app avisa toda vez que você entra nele. **Atualizar agora** baixa, fecha por alguns segundos e reabre na versão nova. As conversas e a conexão continuam.

O Windows pode mostrar "O Windows protegeu o computador" na primeira instalação, porque o instalador não tem assinatura digital paga. Clique em **Mais informações › Executar assim mesmo**.

## Jev

Em **Configurações**, cole a chave de API do Jev (ou defina `JEV_API_KEY` em `.env.local`). Com a classificação automática ligada, cada conversa que recebe mensagem é classificada 15 s depois da última mensagem da rajada. O Jev recebe o nome do contato e o texto das últimas 30 mensagens. Etiqueta escolhida à mão nunca é sobrescrita.

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
pnpm release    # publica versão nova no GitHub Releases (exige main limpa e gh logado)
pnpm test       # testes (node --test)
pnpm typecheck
```

Todo build incrementa a versão exibida no canto da tela. `pnpm release` faz o commit da versão, envia para a `main`, gera o instalador e publica a release; os apps instalados passam a avisar da versão nova.

Feche o app instalado antes de rodar `pnpm dev` ou `pnpm app` com a mesma sessão: dois clientes com a mesma sessão derrubam um ao outro.

Pilha: Electron 44 (Node 24, `node:sqlite`), Baileys (protocolo multi-device do WhatsApp), React + esbuild, Design System Betinhos 1.4.0.

**Risco:** Baileys é um cliente não oficial do WhatsApp. Há risco de restrição da conta, principalmente com envios em massa. Use para atender as suas conversas, não para disparos.
