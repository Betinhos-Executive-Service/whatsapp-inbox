# Editor de imagem no app — design

Data: 13/10/2026 · Status: aprovado em conversa

## Objetivo

Editar uma imagem antes de enviá-la, como no WhatsApp: cortar e girar, desenhar à mão, escrever texto e borrar (pixelar) áreas sensíveis. Tudo no próprio app, sem passar por outro programa.

## Escopo v1

- Ferramentas: **Cortar** (livre, 1:1, 4:3, 16:9), **Girar 90°**, **Espelhar**, **Desenhar** (caneta com 7 cores e 3 espessuras), **Texto** (posicionar, editar, arrastar; 7 cores e 3 tamanhos), **Borrar** (pixelar um retângulo).
- Desfazer e refazer (botões e Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y), até 50 passos.
- Entradas:
  1. botão de lápis em cada imagem da bandeja de anexos (a imagem editada substitui a original na bandeja);
  2. "Editar e enviar" no menu de uma imagem da conversa (baixa a mídia, abre o editor e coloca o resultado na bandeja do chat atual).
- Fora do escopo: emojis/figurinhas, filtros, ajuste de brilho, editar vídeo/GIF, enviar direto do editor sem passar pela bandeja.

## Arquitetura

Tudo no cliente. O servidor e a rota `/send-media` não mudam: o editor devolve um `File` novo, que segue pelo fluxo de anexos existente (`toAttachment` → `fileToOutgoing` → `api.sendMedia`).

```
ui/image-editor/
  model.ts          estado puro (sem DOM): geometria, histórico, camadas, recorte
  render.ts         desenha o estado num canvas e exporta o File final
  ImageEditor.tsx   tela cheia: barra superior, palco com canvas, barra de ferramentas
  image-editor.css  estilos com tokens do design system
```

### Modelo

- `EditState = { width, height, crop, rotation, flip, layers }`. As camadas (traço, texto, borrado) ficam em **coordenadas da imagem original**, então cortar ou girar não reescreve camadas.
- A saída é dada por uma matriz afim `outputMatrix(state)` (recorte → espelho → giro). `srcToOut` e `outToSrc` usam essa matriz e sua inversa; o mesmo cálculo serve para a tela e para a exportação.
- O texto é sempre desenhado na vertical (posição transformada, glifos não giram nem espelham).
- O histórico (`past / present / future`) guarda estados imutáveis. "Há alteração" = existe passado.

### Renderização e exportação

- `paint(ctx, bitmap, state, scale, extra?)` desenha imagem + camadas; `extra` é a camada em andamento (traço/retângulo sendo arrastado).
- O borrado pixela os pixels da imagem original dentro do retângulo (reduz e amplia sem suavização). No arquivo exportado, a informação original daquela área deixa de existir.
- Exportação: `OffscreenCanvas` no tamanho final. PNG continua PNG; os outros formatos saem como JPEG com qualidade 0,92 e fundo branco. Nome do arquivo: `<nome>-editada.<ext>`.
- A carga usa `createImageBitmap`, que respeita a orientação EXIF.

### Interface (design system Betinhos)

- Tela cheia sobre o véu navy já usado no lightbox (`rgba(0, 26, 61, .84)`); as barras ficam em `--bt-color-surface` e usam os componentes `Button` e `SegmentedControl`, com ícones lucide.
- Cores de anotação vêm de tokens lidos em tempo de execução: `white`, `ink-950`, `red-700`, `amber-700`, `green-600`, `blue-600`, `navy-900`. Nenhum hexadecimal novo.
- Fechar: X, Esc ou clique no véu fora da imagem. Com alteração, abre `Dialog` "Descartar alterações?" com "Continuar editando" e "Descartar". Durante o salvamento não fecha.
- Teclado: setas no `SegmentedControl`, foco visível, `role="dialog"` e `aria-modal`. Pointer events cobrem mouse, toque e caneta.
- Light-only, sem gradiente.

## Erros

| Situação | Comportamento |
|---|---|
| Formato fora de JPEG/PNG/WEBP (ex.: GIF, figurinha) | Botão de editar não aparece; no menu, aviso "Este formato de imagem não pode ser editado." |
| Mais de 8000 px num lado | Editor mostra o erro e oferece só "Fechar"; o anexo original fica intacto |
| Falha ao baixar mídia recebida | Toast de erro "Não foi possível abrir a imagem. Ela pode ter expirado no WhatsApp." |
| Falha na exportação | Alerta no editor, edição preservada para tentar de novo |
| Concluir sem alteração | Fecha sem regravar o arquivo |

## Testes

- `tests/image-editor.test.ts` (`node --test`): matriz e inversa para os 4 giros com e sem espelho, `outputSize`, histórico (commit, desfazer, refazer, limite), `setCrop` com limites, gestos de recorte (mover, cantos, proporção), localização da alça, acerto em texto, nome e tipo do arquivo exportado.
- `pnpm typecheck`, `pnpm test` e `pnpm build`.
- Manual no app (`pnpm dev`): anexar foto → editar com cada ferramenta → enviar; "Editar e enviar" numa imagem recebida; Esc com alteração; imagem retrato com EXIF.
