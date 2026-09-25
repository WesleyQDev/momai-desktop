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

A automação é SEMPRE passo a passo: leia a tela (`desktop_snapshot`), aja
em UM elemento (`desktop_click`/`desktop_type`/`desktop_press`) e use a
tela que a própria ação devolve antes do próximo passo. Não existe atalho
que execute vários passos numa chamada só.

## Ferramentas de abertura

| Ferramenta | Uso |
| --- | --- |
| `search_local_items {query}` | Busca programas, arquivos e pastas pelo nome (uma vez só, decida pelo score; inclui apps da Loja como Calculadora via shell:AppsFolder) |
| `open_local_item {path, name?}` | Abre pelo caminho absoluto da busca ou shell:AppsFolder, sem mover mouse nem teclado |
| `desktop_launch {query, allowForeground?}` | Abre PROGRAMAS pelo índice direto em segundo plano (Edge, Firefox, Calculadora, Configurações). Jeito preferido de abrir programa: sem snapshot, sem foco, sem simular o Iniciar. O fallback por keystrokes exige allowForeground:true com a confirmação do usuário |

## Ferramentas de automação (computer use)

| Ferramenta | Uso |
| --- | --- |
| `desktop_snapshot {scope?, objective?, apps?}` | Lê a janela da tarefa (amarrada por launch — cliques do usuário em outra janela não desviam a leitura) e lista os elementos como refs numeradas. Sem tarefa amarrada, lê a janela ativa. Com `apps: ["Nome"]` força esse programa mesmo atrás da janela ativa (abre sozinho em 2º plano se fechado). Chame no início/retomada da tarefa e quando o último resultado não trouxer a tela — cada ação já devolve a tela nova com as refs |
| `desktop_find {query, role?, snapshotId?}` | Procura um elemento pelo nome visível no último snapshot |
| `desktop_click {ref, snapshotId?}` | Clica no elemento da ref (tenta o padrão nativo primeiro). O resultado já traz a tela nova com as refs renumeradas; em caso de falha, traz a tela atual junto do erro |
| `desktop_type {ref, text, submit?, snapshotId?}` | Digita num campo da ref (`submit:true` dá Enter). O resultado já traz a tela nova (endereço web enviado espera a página carregar antes de ler) |
| `desktop_press {ref, key, snapshotId?}` | Pressiona tecla com a ref focada (sintaxe SendKeys: `{ENTER}`, `{TAB}`, `^c`). O resultado já traz a tela nova |
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
- "abra a calculadora e faça 10*5 e feche" → `desktop_launch` → `desktop_press` com a conta inteira (`10*5{ENTER}`; o resultado já traz a tela nova) → clique no botão Fechar/Close (ou `desktop_press` com `%{F4}`). Nunca clique em dígito, sempre `press` com a conta; dígitos aceitam nomes por extenso e IDs internos, e `+` vai escapado sozinho
- "abra o navegador e vá para <endereço>" → `desktop_launch` (o resultado já traz a tela) → digite o endereço na barra de endereços com `desktop_type {ref, text, submit:true}` (ou foque a barra com `desktop_press {ref, key:"^l"}` antes)
- "abra minha pasta de Downloads" → `search_local_items` + `open_local_item`
- "clique em Salvar no Bloco de Notas" → `desktop_snapshot` → `desktop_find {query: "Salvar"}` → `desktop_click {ref}`
- "digite meu e-mail no campo" → `desktop_snapshot` → `desktop_click`/`desktop_type {ref, text}`
- "o que tem na minha tela?" → `desktop_screenshot` (mostra) e/ou `desktop_describe` (detalha)
- "o que você fez?" → `desktop_get_run` (mostra o card com o passo a passo)

## Sequência (continuidade entre passos)

Toda tarefa composta segue o mesmo encadeamento. Nunca pare no meio para
perguntar e nunca repita `search_local_items` com paráfrases: uma busca
basta, decida pelo score.

  1. Abra o programa (`desktop_launch`) ou o arquivo/pasta
     (`search_local_items` → `open_local_item`): o resultado já traz a tela
     da janela aberta. Se ele não trouxer a tela (o app pode estar abrindo
     devagar), chame `desktop_snapshot`.
  2. A CADA passo: `desktop_find` (quando precisar do nome exato) →
     `desktop_click`/`desktop_type`/`desktop_press`. O resultado da ação JÁ
     traz a NOVA TELA com as refs renumeradas — use-a direto no próximo
     passo, SEM chamar `desktop_snapshot` de novo. Só leia a tela por conta
     própria no início/retomada da tarefa, quando o resultado não trouxer a
     tela, ou quando ele avisar que a janela mudou. As refs antigas morrem
     quando a tela muda: nunca digite ou clique com refs da tela anterior e
     nunca encerre a resposta no meio da tarefa.
  3. Para preencher vários campos/células conhecidos, digite e navegue com
     Tab/Enter em vez de clicar um por um (`desktop_type` com
     `submit:true` dá Enter).
  4. NUNCA desista no primeiro erro: a falha já devolve a tela atual junto
     do motivo — ajuste o nome/papel do elemento (ou use outra ref) e tente
     de novo NA MESMA rodada. Errar um comando não encerra a tarefa. Nunca
     peça para o usuário digitar à mão nem passe `ref` vazio para clique.
  5. A CADA rodada escreva 1 linha curta de progresso JUNTO com a chamada
     (ex.: "Passo 2: clicando em Salvar") — rodadas mudas em sequência são
     lidas como loop e o host corta suas tools; e nunca repita a mesma
     chamada idêntica: ajuste algo ou conclua.
  6. Encerre TODA tarefa com `desktop_stop_run`: é ele que mostra o card
     final com o replay no chat. Sem isso, a tarefa termina sem card.
  7. Só pare para perguntar quando houver ambiguidade real (dois botões
     iguais, ação destrutiva).

  Telas opacas (canvas, jogos, frames sem acessibilidade) não são
  clicáveis — use `desktop_describe` para responder o que aparece nelas.
  Se o snapshot avisar TELA OPACA, NÃO tire outro snapshot: a árvore não
  vai mudar. Só declare impossível com sinceridade se `desktop_describe`
  também responder indisponível.

  Para abrir PROGRAMAS avulsos use `desktop_launch` (busca do Windows:
  resolve Edge, Firefox, Calculadora e apps da Loja sem precisar de
  caminho). Para ARQUIVOS E PASTAS, ache UMA vez (`search_local_items`) e
  abra o melhor resultado (`open_local_item`, preferindo Programa/Atalho
  com maior score). Se dois candidatos forem igualmente prováveis e a
  tarefa for SOMENTE abrir, aí sim pergunte; se a tarefa continua (clicar,
  digitar, automatizar), abra o melhor e siga — o snapshot da janela
  confirma se acertou. NUNCA troque o programa pedido por outro: abra o
  nome exato pedido (um navegador NÃO substitui um serviço web com app
  instalado). Na dúvida se o app existe, confira com `search_local_items`
  antes — um score alto no nome exato confirma.

  Exemplo de encadeamento ("abra o <programa>, crie um novo <documento> e
  digite <texto>"): `desktop_launch` (a tela vem no resultado) →
  `desktop_find {query:"<opção de novo>"}` → `desktop_click` (a tela nova
  vem no resultado) → `desktop_type {ref, text:"<texto>"}` →
  `desktop_stop_run`.

## Regras

- Elementos só valem dentro do `snapshotId`: refs expiram em ~90s ou quando a janela muda — o resultado de cada ação já devolve a tela nova com as refs renumeradas; só tire outro `desktop_snapshot` quando o resultado não trouxer a tela
- `desktop_find` responde só texto (sem card) para não encher o chat; cada ação (`click/type/press`, `stop_run`) mostra o card com o replay atualizado
- Se o app não estiver na lista de permitidos, oriente a liberar no page do MomAI Desktop
- Passos que precisam do primeiro plano (`press`, fallbacks de mouse/teclado) são recusados enquanto os guardrails proibirem: peça ao usuário e repita a chamada com allowForeground:true
- Se a janela trocar sozinha no meio da tarefa (safe-stop ligado), confirme o app certo e recomece
- Automação precisa de Windows; em outro sistema, explique o limite em vez de chutar coordenadas
- PROIBIDO explicar ao usuário como ele faria manualmente ("basta clicar em..."): execute VOCÊ com as tools até concluir a tarefa de ponta a ponta
- Antes de cada clique/digitacao, confira no snapshot se App/Janela e o app da tarefa. Se o snapshot avisar que a janela ativa mudou, PARE e avise o usuario: nunca clique ou digite na janela errada

## Página da extensão

O page mostra o replay (um screenshot por chamada de tool, com título traduzido e legenda de contexto, em reprodução automática), o histórico de execuções (expansível, com filtro) e os controles: limites de passos/tempo, apps permitidos, parar ao trocar de janela e replay visual. O card único aparece no chat SÓ no fim da tarefa.
