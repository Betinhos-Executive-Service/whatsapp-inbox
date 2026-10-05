# WhatsApp Inbox

Inbox local e leve para gerir e classificar as conversas do seu WhatsApp. Roda no seu PC, sem Docker e sem banco externo.

- **Conversas por status:** Abertas, Aguardando e Resolvidas. Mensagem nova reabre a conversa; resposta sua passa para Aguardando.
- **Etiquetas** editáveis (Cotação, Reserva, Operação…), escolhidas por você ou sugeridas pelo **Jev**.
- **Responder** pelo próprio app (texto). Mídia aparece como `[Imagem]`, `[Áudio]` etc.
- Só conversas individuais: grupos, status e canais ficam de fora.

## Usar

```bash
pnpm install
pnpm start
```

Abra http://127.0.0.1:38291. Na primeira vez, leia o código QR pelo celular (WhatsApp › Aparelhos conectados › Conectar aparelho). A sessão fica salva; nas próximas vezes conecta sozinho.

`pnpm start` compila a interface (~1 s) e sobe o servidor. A tela abre em menos de 1 s; o WhatsApp conecta logo em seguida.

## Jev

Em **Configurações**, cole a chave de API do Jev (ou defina `JEV_API_KEY` em `.env.local`). Com a classificação automática ligada, cada conversa que recebe mensagem é classificada 15 s depois da última mensagem da rajada. O Jev recebe o nome do contato e o texto das últimas 30 mensagens. Etiqueta escolhida à mão nunca é sobrescrita.

## Dados

Tudo fica em `data/` (fora do Git):

- `data/inbox.db`: conversas, mensagens, etiquetas e configurações (SQLite);
- `data/auth/`: sessão do WhatsApp. Apagar a pasta desconecta o PC.

O servidor só escuta em `127.0.0.1` e recusa pedidos de outras origens.

## Desenvolvimento

```bash
pnpm dev        # recompila a interface a cada mudança e reinicia o servidor
pnpm test       # testes (node --test)
pnpm typecheck
```

`pnpm dev` e `pnpm build` incrementam a versão de build exibida no canto da tela.

Pilha: Node 24 (TypeScript nativo, `node:sqlite`), Baileys (protocolo multi-device do WhatsApp), React + esbuild, Design System Betinhos 1.4.0.

**Risco:** Baileys é um cliente não oficial do WhatsApp. Há risco de restrição da conta, principalmente com envios em massa. Use para atender as suas conversas, não para disparos.
