# WhatsApp Inbox

Caixa de entrada local do WhatsApp da Betinhos: recebe, organiza e responde as conversas da conta, ligada como um aparelho conectado ao celular.

## Conexão e recebimento

**Aparelho conectado**:
Este app, visto pelo WhatsApp como um dos dispositivos da conta, ao lado do **Celular principal**.
_Evite_: cliente, sessão do WhatsApp

**Celular principal**:
O telefone em que a conta do WhatsApp está registrada, que autoriza o **Aparelho conectado** pelo QR.
_Evite_: telefone mestre, host

**Fila offline**:
As mensagens, recibos e avisos que o WhatsApp guarda enquanto o **Aparelho conectado** está desconectado e entrega ao reconectar. Ela termina quando o WhatsApp avisa que não há mais nada pendente.
_Evite_: histórico, sincronização, backlog

**Histórico**:
As conversas antigas que o **Celular principal** envia ao **Aparelho conectado** no pareamento. É diferente da **Fila offline**.
_Evite_: sync, backup

**Número**:
O telefone de uma conta do WhatsApp, como aparece para quem tem o contato salvo.
_Evite_: PN, telefone (como identificador)

**LID**:
O identificador privado que o WhatsApp atribui a cada conta, além do **Número**. A mesma pessoa pode chegar por um ou por outro, e o app as trata como uma só conversa.
_Evite_: id oculto, número falso

## Criptografia e recuperação

**Sessão de criptografia**:
O estado de cifragem que o **Aparelho conectado** mantém com cada dispositivo de cada contato. Sem ela correta, a mensagem chega mas não abre.
_Evite_: sessão (sozinho), login

**Mensagem aguardando**:
Uma mensagem que chegou mas não pôde ser decifrada, mostrada na conversa como aviso até o **Reenvio** chegar.
_Evite_: mensagem perdida, mensagem com erro

**Reenvio**:
O pedido para que o contato (ou o **Celular principal**) mande de novo uma **Mensagem aguardando**, junto com o que for preciso para abrir uma **Sessão de criptografia** nova.
_Evite_: retry, nova tentativa
