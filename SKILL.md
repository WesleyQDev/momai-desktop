---
name: MomAI Desktop
description: Abre programas, pastas e arquivos no computador, automatiza a tela lendo os botões pelo nome e mostra ou detalha screenshots. Use quando o usuário pedir para abrir algo, clicar, digitar, automatizar uma tarefa ou perguntar o que aparece na tela.
---

# MomAI Desktop

Abre itens locais e automatiza programas. A tela é lida pela árvore de
acessibilidade do Windows (UI Automation), em texto: o `desktop_snapshot`
lista botões e campos com nome e ref numerada, e não tira print.
Screenshots existem para o replay e para mostrar a tela ao usuário.

A automação é passo a passo: leia a tela, aja em UM elemento e use a tela
que a própria ação devolve no passo seguinte. As ações
(`desktop_click`/`desktop_type`/`desktop_press`), o `desktop_launch` e o
`open_local_item` já devolvem a NOVA TELA com as refs renumeradas — não
precisa tirar snapshot de novo entre um passo e outro.

## Ferramentas de abertura

| Ferramenta | Uso |
| --- | --- |
| `search_local_items {query}` | Busca programas, arquivos e pastas pelo nome. Uma busca basta: decida pelo score, sem repetir com paráfrases. Inclui apps da Loja, como a Calculadora |
| `open_local_item {path, name?}` | Abre por caminho absoluto (ou shell:AppsFolder), sem mover mouse nem teclado |
| `desktop_launch {query, allowForeground?}` | Abre PROGRAMAS em segundo plano (Edge, Firefox, Calculadora, Configurações), sem snapshot e sem foco. Jeito preferido de abrir programa; o fallback por teclado pede `allowForeground:true` depois que o usuário confirmar |

## Ferramentas de automação (computer use)

| Ferramenta | Uso |
| --- | --- |
| `desktop_snapshot {scope?, objective?, apps?}` | Lê a janela da tarefa e lista as refs. Chame no início ou na retomada e quando o último resultado não trouxer a tela. `apps: ["Nome"]` força um programa mesmo atrás da janela ativa |
| `desktop_find {query, role?, snapshotId?}` | Procura um elemento pelo nome visível no último snapshot. Responde só texto, sem card |
| `desktop_click {ref, snapshotId?}` | Clica na ref, preferindo o padrão em segundo plano |
| `desktop_type {ref, text, submit?, snapshotId?}` | Digita num campo da ref; `submit:true` dá Enter |
| `desktop_press {ref, key, snapshotId?}` | Pressiona tecla com a ref focada (SendKeys: `{ENTER}`, `{TAB}`, `^c`) |
| `desktop_describe {question?, screen?}` | Detalha o que aparece na tela, para orientar em área opaca. Precisa de modelo com visão |
| `desktop_screenshot {screen?}` | Mostra a tela ao usuário como imagem no chat |
| `desktop_get_run {runId?}` | Mostra a execução com a linha do tempo dos passos |

`desktop_get_frames`, `desktop_list_runs` e `desktop_settings` são de uso do
page: o modelo não precisa chamar.

## Gramática

- "abra o chrome" → `desktop_launch {query: "chrome"}`
- "abra a calculadora" → `desktop_launch {query: "calculadora"}`
- "abra a calculadora e faça 10*5 e feche" → `desktop_launch` → `desktop_press` com a conta inteira (`10*5{ENTER}`) → clique em Fechar/Close (ou `desktop_press` com `%{F4}`). Conta vai inteira no `press`, em vez de clicar em dígito
- "abra o navegador e vá para <endereço>" → `desktop_launch` → `desktop_type {ref, text, submit:true}` na barra de endereços (ou foque com `desktop_press {ref, key:"^l"}`)
- "abra minha pasta de Downloads" → `search_local_items` + `open_local_item`
- "clique em Salvar no Bloco de Notas" → `desktop_snapshot` → `desktop_find` → `desktop_click`
- "digite meu e-mail no campo" → `desktop_snapshot` → `desktop_type {ref, text}`
- "o que tem na minha tela?" → `desktop_screenshot` (mostra) e/ou `desktop_describe` (detalha)
- "o que você fez?" → `desktop_get_run`

## Sequência

1. Abra o programa (`desktop_launch`) ou o arquivo/pasta
   (`search_local_items` → `open_local_item`). Se o resultado não trouxer a
   tela, chame `desktop_snapshot`.
2. A cada passo: `desktop_find` (quando precisar do nome exato) →
   `desktop_click`/`desktop_type`/`desktop_press`. Refs valem só dentro do
   `snapshotId` e morrem quando a tela muda: use sempre as do último
   resultado.
3. Para vários campos conhecidos, navegue com Tab/Enter em vez de clicar um
   por um (`desktop_type` com `submit:true`).
4. Errou? A falha devolve a tela atual com o motivo. Ajuste o alvo (nome,
   papel ou outra ref) e tente de novo na mesma rodada: errar um comando não
   encerra a tarefa.
5. Encerre a tarefa com `desktop_stop_run`. O card com o replay aparece
   sozinho no fim da resposta, sem tool extra.

Pare para perguntar só quando houver ambiguidade real (dois botões iguais,
ação destrutiva) — não peça para o usuário digitar à mão.

Telas opacas (canvas, jogos, frames sem acessibilidade) não são clicáveis:
use `desktop_describe`. Se o snapshot avisar TELA OPACA, não tire outro
snapshot: a árvore não muda.

Para ARQUIVOS E PASTAS, ache uma vez (`search_local_items`) e abra o melhor
resultado (`open_local_item`, preferindo Programa/Atalho com maior score).
Se dois candidatos forem igualmente prováveis e a tarefa for só abrir, aí
sim pergunte; se a tarefa continua (clicar, digitar, automatizar), abra o
melhor e siga — o snapshot confirma se acertou. Abra o nome exato pedido: um
navegador não substitui um app instalado para o serviço.

Exemplo ("abra o <programa>, crie um novo <documento> e digite <texto>"):
`desktop_launch` → `desktop_find {query:"<opção de novo>"}` →
`desktop_click` → `desktop_type {ref, text}` → `desktop_stop_run`.

## Regras

- Clique ou digite só com refs do último resultado, dentro do mesmo `snapshotId` (~90s de validade)
- Se o snapshot avisar que a janela ativa mudou, pare e avise o usuário: não clique nem digite na janela errada
- Passos que precisam do primeiro plano (`press`, fallback de mouse/teclado) são recusados pelos guardrails: peça a confirmação e repita com `allowForeground:true`
- App fora da lista de permitidos: oriente a liberar no page do MomAI Desktop
- Automação precisa de Windows; em outro sistema, explique o limite em vez de chutar coordenadas
- Conclua a tarefa ponta a ponta você mesmo, sem explicar ao usuário como ele faria manualmente

## Página da extensão

Mostra o replay (um screenshot por chamada, com título e legenda, em
reprodução automática), o histórico de execuções e os controles: apps
permitidos, limites, safe-stop e replay visual.
