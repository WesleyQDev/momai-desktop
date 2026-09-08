---
name: MomAI Desktop
description: Abre programas, pastas e arquivos no computador, automatiza a tela lendo os botões pelo nome e mostra ou detalha screenshots. Use quando o usuário pedir para abrir algo, clicar, digitar, automatizar uma tarefa ou perguntar o que aparece na tela.
---

# MomAI Desktop

O MomAI Desktop abre itens locais e automatiza programas: a análise dos
elementos da tela é feita pela árvore de acessibilidade do Windows
(UI Automation), em texto. O snapshot NÃO tira print — ele lista
botões/campos com nome e posição. Screenshots existem só para replay,
para mostrar ao usuário (`desktop_screenshot`) e para detalhar a tela
(`desktop_describe`).

## Ferramentas de abertura

| Ferramenta | Uso |
| --- | --- |
| `search_local_items {query}` | Busca ARQUIVOS E PASTAS pelo nome (uma vez só, decida pelo score) |
| `open_local_item {path, name?}` | Abre arquivo/pasta pelo caminho absoluto da busca |
| `desktop_launch {query}` | Abre PROGRAMAS pela busca do Windows (Edge, Firefox, Calculadora, Configurações). Jeito preferido de abrir programa: sem snapshot, sem foco |
| `desktop_act {objective?, steps}` | Executa a TAREFA INTEIRA numa chamada (jeito preferido p/ sequências): steps `[{op:"launch",query}, {op:"click",name,role?}, {op:"type",name,text,submit?}, {op:"press",name?,key}, {op:"wait",ms?}]`. Resolve nomes na tela fresca com retries (nome+papel, depois só nome); respeita os limites do page |

## Ferramentas de automação (computer use)

| Ferramenta | Uso |
| --- | --- |
| `desktop_snapshot {scope?, objective?}` | Lê a janela ativa e lista os elementos como refs numeradas. Chame sempre antes de clicar/digitar |
| `desktop_find {query, role?, snapshotId?}` | Procura um elemento pelo nome visível no último snapshot |
| `desktop_click {ref, snapshotId?}` | Clica no elemento da ref (tenta o padrão nativo primeiro) |
| `desktop_type {ref, text, submit?, snapshotId?}` | Digita num campo da ref (`submit:true` dá Enter) |
| `desktop_press {ref, key, snapshotId?}` | Pressiona tecla com a ref focada (sintaxe SendKeys: `{ENTER}`, `{TAB}`, `^c`) |
| `desktop_describe {question?, screen?}` | Olha a tela e detalha o que aparece (ou responde à pergunta). Para se orientar em área complicada/opaca. Precisa de modelo com visão |
| `desktop_screenshot {screen?}` | Mostra a tela ao USUÁRIO como imagens no chat (todas as telas, ou uma via `screen`). Para o modelo se orientar, use `desktop_describe` |
| `desktop_get_run {runId?}` | Mostra a execução com a timeline de passos (também alimenta o card do chat) |
| `desktop_get_frames {runId?}` | Replay da execução para o page (screenshots com títulos). Uso do page; o modelo não precisa chamar |
| `desktop_list_runs {limit?}` | Lista execuções recentes |
| `desktop_stop_run {runId?}` | Para a execução ativa |
| `desktop_settings` | Lê os guardrails (apps permitidos, limites, replay, safe-stop) |

## Gramática

- "abra o chrome" → `desktop_launch {query: "chrome"}`
- "abra a calculadora" → `desktop_launch {query: "calculadora"}`
- "abra minha pasta de Downloads" → `search_local_items` + `open_local_item`
- "clique em Salvar no Bloco de Notas" → `desktop_snapshot` → `desktop_find {query: "Salvar"}` → `desktop_click {ref}`
- "digite meu e-mail no campo" → `desktop_snapshot` → `desktop_click`/`desktop_type {ref, text}`
- "o que tem na minha tela?" → `desktop_screenshot` (mostra) e/ou `desktop_describe` (detalha)
- "o que você fez?" → `desktop_get_run` (mostra o card com o passo a passo)

## Sequência (continuidade entre passos)

Toda tarefa composta segue o mesmo encadeamento. Nunca pare no meio para
perguntar e nunca repita `search_local_items` com paráfrases: uma busca
basta, decida pelo score.

1. Para QUALQUER tarefa com 2+ passos (abrir → clicar → digitar),
   SEMPRE comece com `desktop_act` e a sequência inteira NUMA chamada —
   ele resolve cada nome na tela fresca, espera o app abrir e tenta de
   novo sozinho. NÃO faça a sequência manualmente com as primitivas.
   Use as primitivas (`desktop_snapshot` → `desktop_find` →
   `desktop_click` / `desktop_type`) SÓ para explorar uma tela
   desconhecida antes de montar o `desktop_act`, ou quando o `desktop_act`
   falhar 2 vezes seguidas.
   NUNCA desista no primeiro erro: se um passo falhar, ajuste (novo nome,
   role diferente) e chame `desktop_act` de novo. Errar um comando não
   encerra a tarefa. Telas opacas (canvas, jogos, frames sem
   acessibilidade) não são clicáveis — use `desktop_describe` para
   responder o que aparece nelas.
   Se o snapshot avisar TELA OPACA, NÃO tire outro snapshot: a árvore não
   vai mudar. Só declare impossível com sinceridade se `desktop_describe`
   também responder indisponível.
2. Para abrir PROGRAMAS avulsos use `desktop_launch` (busca do Windows: resolve Edge,
   Firefox, Calculadora e apps da Loja sem precisar de caminho). Para
   ARQUIVOS E PASTAS, ache UMA vez (`search_local_items`) e abra o melhor
   resultado (`open_local_item`, preferindo Programa/Atalho com maior
   score).
   Se dois candidatos forem igualmente prováveis e a tarefa for SOMENTE
   abrir, aí sim pergunte; se a tarefa continua (clicar, digitar,
   automatizar), abra o melhor e siga — o snapshot da janela confirma se
   acertou.
   NUNCA troque o programa pedido por outro: abra o nome exato pedido
   (um navegador NÃO substitui um serviço web com app instalado). Na
   dúvida se o app existe, confira com `search_local_items` antes — um
   score alto no nome exato confirma.
3. Leia a tela (`desktop_snapshot`) — o app recém-aberto pode demorar um
   instante; o snapshot tenta de novo sozinho, mas se vier vazio repita a
   chamada
4. Aja em sequência, sem perguntar a cada passo: `desktop_find` →
   `desktop_click` / `desktop_type` → novo `desktop_snapshot` (a tela
   mudou, as refs antigas morreram) → continue até o objetivo.
   Depois de cada clique OBRIGATORIAMENTE tire outro snapshot antes do
   próximo passo — nunca digite ou clique com refs da tela anterior e
   nunca encerre a resposta no meio da tarefa.
   A CADA rodada escreva 1 linha curta de progresso JUNTO com a chamada
   (ex.: "Passo 2: clicando em Salvar") — rodadas mudas em sequência são
   lidas como loop e o host corta suas tools; e nunca repita a mesma
   chamada idêntica: ajuste algo ou conclua.
5. Encerre TODA tarefa com desktop_stop_run: e ele que mostra o card final com o replay no chat. Sem isso, a tarefa termina sem card
6. So pare para perguntar quando houver ambiguidade real (dois botoes
   iguais, ação destrutiva)

Exemplo de encadeamento ("abra o <programa>, crie um novo <documento> e
digite <texto>"): `desktop_act` com
`[{op:"launch",query:"<programa>"},{op:"click",name:"<opção de novo>"},
{op:"type",role:"Document",text:"<texto>"}]`.

## Regras

- Elementos só valem dentro do `snapshotId`: refs expiram em ~90s ou quando a janela muda — tire outro `desktop_snapshot` e use as novas refs
- `desktop_find` responde só texto (sem card) para não encher o chat; cada ação (`click/type/press`, fim de `desktop_act`, `stop_run`) mostra o card com o replay atualizado
- Se o app não estiver na lista de permitidos, oriente a liberar no page do MomAI Desktop
- Respeite os limites do page (passos e tempo máximos): ao atingi-los, encerre com honestidade em vez de insistir
- Se a janela trocar sozinha no meio da tarefa (safe-stop ligado), a execução para por segurança — confirme o app certo e recomece
- Automação precisa de Windows; em outro sistema, explique o limite em vez de chutar coordenadas
- PROIBIDO explicar ao usuário como ele faria manualmente ("basta clicar em..."): execute VOCÊ com as tools até concluir a tarefa de ponta a ponta
- Antes de cada clique/digitacao, confira no snapshot se App/Janela e o app da tarefa. Se o snapshot avisar que a janela ativa mudou, PARE e avise o usuario: nunca clique ou digite na janela errada

## Página da extensão

O page mostra o replay (um screenshot por chamada de tool, com título traduzido e legenda de contexto, em reprodução automática), o histórico de execuções (expansível, com filtro) e os controles: limites de passos/tempo, apps permitidos, parar ao trocar de janela e replay visual. O card único aparece no chat SÓ no fim da tarefa.
