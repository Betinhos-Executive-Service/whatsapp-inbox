# Contatos: criar, editar, excluir e listar

Data: 06/11/2026. Referência de comportamento: WhatsApp normal.

## Objetivo

Hoje o Inbox só recebe nomes do WhatsApp (`contacts.upsert`). Não dá para criar, editar nem excluir contato, "Nova conversa" aceita só número e o cartão de contato recebido não tem "Salvar".

Esta entrega permite gerir contatos dentro do Inbox, com sincronização na conta do WhatsApp:

1. Formulário de novo contato, edição e exclusão.
2. "Salvar contato" nos lugares onde a pessoa aparece.
3. Lista de contatos, com busca, a partir de "Nova conversa".
4. Animações discretas, só em CSS.

## Fora do escopo

- Fila de reenvio offline: salvar exige conexão.
- Trocar o número de um contato existente: exclui e cria outro.
- Vários números no mesmo contato: o cartão usa o primeiro.
- Refletir no Inbox um contato excluído pelo celular (ver "Limites conhecidos").
- Faixa "não está nos seus contatos" no topo da conversa.

## Gravação

Ordem: WhatsApp primeiro, banco local depois. Se o WhatsApp recusar, nada muda localmente e o erro aparece no formulário. Assim o Inbox nunca mostra um nome que a conta não tem.

### Baileys

Versão 7.0.0-rc14, sem patch novo:

- `addOrEditContact(jid, action)`, com `action`:
  - `fullName`: nome e sobrenome juntos.
  - `firstName`: nome.
  - `saveOnPrimaryAddressbook: true`: pede para salvar na agenda do celular.
  - `lidJid`: quando o `lid_map` conhece o LID.
- `removeContact(jid)`.
- `jid` é sempre o JID de telefone (`@s.whatsapp.net`). LID sem telefone conhecido não pode ser salvo.

### Servidor

`server/http.ts`, com validação zod e novos métodos na interface `api`:

| Rota | Corpo | Efeito |
|---|---|---|
| `GET /api/contacts` | | Contatos com `saved_name`, em ordem alfabética (pt-BR), inclusive sem conversa aberta |
| `POST /api/contacts` | `{ phone, firstName, lastName? }` | Confere o número, grava na conta, chama `setNames` e devolve o contato |
| `DELETE /api/contacts/:jid` | | `removeContact` e limpeza local; devolve 204 |

- `GET /api/contacts/check?phone=` confere o número sem gravar. Devolve `{ jid, savedName }`, com `jid: null` quando o número não tem WhatsApp. O formulário usa essa rota antes de salvar.
- `firstName` tem de 1 a 100 caracteres depois de `trim`; `lastName` vai até 100.
- Sem conexão, as rotas de escrita e o `check` falham com a mensagem padrão de "não conectado".
- Número sem WhatsApp no `POST`: erro 400 "Este número não tem WhatsApp."

### Banco

`server/db.ts`, sem tabela nova:

- `listContacts()`: consulta a tabela `contacts` com `saved_name` não nulo.
- `clearSavedName(jid)`: zera `saved_name` em `contacts` e `chats`, porque `setNames` usa `coalesce` e não limpa. Devolve a conversa atualizada, e a camada do WhatsApp emite `chat` quando ela existe.
- `Chat` ganha `saved: boolean`, calculado a partir de `saved_name`, sempre falso em grupo. Grupos também usam `saved_name` para o assunto. Perfil, participantes e cartões consultam a lista de contatos compartilhada da interface.

Sobrenome não é coluna: ao editar, tudo depois da primeira palavra do `saved_name` vira sobrenome. O nome completo não muda quando o formulário é salvo sem alteração.

## Interface

### Formulário `ContactForm` (`ui/contacts.tsx`)

Componente único, sobre o `FormModal`, que já pergunta antes de descartar alterações.

Entrada: `{ phone?, name?, jid? }`. Com `jid` de contato salvo, entra em modo edição.

- Campos: Nome (obrigatório), Sobrenome e Telefone.
- Nome inicial: nome do perfil ou do cartão, dividido na primeira palavra.
- Telefone: somente leitura na edição, com a dica "Para trocar o número, exclua e crie outro contato."
- Verificação do número: dispara ao sair do campo ou 400 ms depois da última tecla, se o número estiver completo.
  - "Verificando…" enquanto consulta.
  - "Este número não tem WhatsApp." bloqueia o salvamento.
  - "Já salvo como Fulano" oferece "Editar", que troca o formulário para o modo edição.
- Falha na consulta do número não bloqueia: o `POST` confere de novo.
- "Excluir contato" aparece só na edição e pede confirmação: "O contato sai da sua agenda. A conversa continua aqui."
- Salvar e excluir ficam desativados sem conexão, com a explicação no `title`.
- Toast ao concluir: "Contato salvo." ou "Contato excluído."

### Pontos de entrada

| Onde | Quando aparece | Ação |
|---|---|---|
| Cabeçalho da conversa | Conversa individual com telefone e `saved: false` | Ícone "Salvar contato" |
| Dados do contato (`ui/profile.tsx`) | Conversa individual ou participante com telefone | "Salvar contato" ou "Editar contato" |
| Cartão recebido (`ContactCards`) | Número ainda não salvo | "Salvar contato" ao lado de "Conversar" |
| Painel de contatos | Sempre | "Novo contato" e menu "Editar" na linha |

Participante sem telefone conhecido não mostra o botão.

Para saber se um cartão já está salvo, a tela busca a lista uma vez e consulta por número. Se a lista não carregar, o botão aparece e o formulário cai no aviso "Já salvo como Fulano".

### Painel de contatos `ContactsPanel` (`ui/contacts.tsx`)

Substitui o `NewChatDialog` no botão "Nova conversa". Desliza sobre a `list-pane`, ocupando a largura dela, sem cobrir a conversa aberta.

- Cabeçalho: voltar e título "Nova conversa".
- Ações fixas: "Novo grupo" (abre o formulário de grupo atual) e "Novo contato".
- `SearchBox` por nome ou número, com foco ao abrir.
- Lista alfabética com letras de seção e normalização de acentos. Linha com foto, nome e telefone.
- Clique na linha abre a conversa e fecha o painel.
- Esc ou voltar fecha o painel.
- Busca que parece número sem contato correspondente mostra "Conversar com +55…", que usa `api.openChat({ phone })`.
- Busca sem resultado: "Nenhum contato com …".
- Erro ao carregar: `Alert` com "Tentar de novo".
- Enquanto carrega: "Carregando contatos…".

`NewChatDialog` deixa o modo "Com um número" e vira só o formulário de grupo (`NewGroupDialog`). O botão continua desativado sem conexão.

## Animações

Só CSS, com tokens do design system. Sem Framer Motion: o projeto não o usa e os tokens bastam.

| Elemento | Entrada | Saída |
|---|---|---|
| Painel de contatos | `translateX(-100%)` para 0, `--bt-duration-slow`, `--bt-ease-drawer` | Inverso em cerca de 220 ms |
| Formulário | Animação atual do `bt-dialog` | Atual |
| Botão salvar | Check por 400 ms antes de fechar | |
| Nome no cabeçalho e no perfil | Crossfade rápido ao mudar (`key` no nome), `--bt-duration-fast` | |
| Linha recém-salva | Realce de fundo que some em cerca de 1 s | |

- Regras: só `transform` e `opacity`, exceto o realce de fundo. Saída do painel controlada por `data-closing` e `onAnimationEnd`.
- Sem entrada em cascata na lista: ela abre muitas vezes ao dia.
- `prefers-reduced-motion: reduce` desliga deslocamentos e mantém só opacidade curta. A saída do painel não depende de `animationend` nesse caso.

## Testes

Rodam no Betinhos-Renan, porque este PC não roda test runner.

- `tests/contacts.test.ts` e novos testes de banco: `listContacts`, ordem com acentos, `clearSavedName` com e sem conversa, `saved` em `Chat`.
- Rotas com `tests/fake-api.ts`: criar, editar, excluir, número sem WhatsApp, validação, sem conexão e ordem "WhatsApp antes do banco" (falha do WhatsApp não altera nada local).
- Função pura de nome e sobrenome.
- `pnpm typecheck`.
- `verificar-interface` no navegador, com o seed fictício: painel, busca, formulário, modo edição, exclusão, botões nos pontos de entrada e reduzir movimento.

## Verificação manual na conta real

Nenhuma destas pode ser testada na nuvem nem com o seed:

1. Salvar um contato novo e ver o nome no celular e na agenda.
2. Editar o nome e ver a mudança no celular.
3. Excluir e ver o efeito no celular.
4. Salvar a partir de um cartão recebido e de um participante de grupo.

Se `saveOnPrimaryAddressbook` não chegar à agenda do celular, o contato ainda vale na conta do WhatsApp. O comportamento é relatado, sem mudança de design.

## Limites conhecidos

- Remoção de contato pelo celular: o tratamento de `contactAction` no Baileys só propaga nomes, sem sinal de remoção para o `applyContact`. O nome pode continuar no Inbox. Confirmar no teste manual.
- O `chatModify` depende das chaves de app state. Sessão recém-pareada pode recusar a gravação até elas chegarem; o erro aparece no formulário.
