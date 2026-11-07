# FMMatchLens — fork com análise tática

Fork pessoal de [osnsyc/FMMatchLens](https://github.com/osnsyc/FMMatchLens) (plugin BepInEx para Football Manager 27 + dashboard React).
O objetivo do fork é um **mecanismo de análise tática descritiva**: ao vivo e pós-jogo, dizer o que está a correr bem/mal
e o que ajustar na tática, nas instruções e nos jogadores. Também agrega vários jogos.

O dono joga FM27 em português (Benfica). Responde e escreve textos de interface em **português de Portugal**.

## Estrutura relevante

- `src/FMMatchLens.Plugin/` — plugin C# (BepInEx 6 IL2CPP). Lê a memória do jogo, expõe API em `127.0.0.1:16726`, grava `.fmlens`.
- `frontend/` — dashboard React + TypeScript + Vite.
- `frontend/src/features/analysis/` — **tudo o que é da análise tática**:
  - `metrics.ts` — métricas por janela (jogo todo / últimos N minutos) a partir de `MatchSnapshot`.
  - `roles.ts` — atributos (escala), traits, papéis → atributos-chave, nomes PT dos papéis e posições.
  - `tacticProfile.ts` — instruções de equipa e individuais (o plugin NÃO as lê; são introduzidas no separador "Tática" e guardadas em `localStorage`). Tática por omissão: "teste2".
  - `engine.ts` — regras que produzem `Insight`s (tom: problem/warning/info/good) e relatórios por jogador.
  - `tacticChanges.ts` / `tacticChangeRecords.ts` — alterações táticas gravadas pelo plugin, tática efetiva e antes/depois.
  - `multiMatch.ts` — análise de vários `.fmlens` e agregação (padrões recorrentes, médias por jogador).
  - `AnalysisDrawer.tsx` — painel lateral (botão "Análise" no cabeçalho).
- `frontend/tests/analysisPlayerName.test.ts` — testes da correção dos nomes.

## Factos sobre os dados (verificados num jogo real; não "corrigir" sem voltar a verificar)

- Coordenadas de eventos/remates em `MatchSnapshot` vão de 0 a 100. A equipa **da casa ataca para x = 100** e o seu flanco esquerdo
  está em **y baixo**; a equipa de fora está espelhada. Usar `forwardX`/`lateralY` de `metrics.ts`.
- 240 ticks por minuto (4 por segundo).
- Atributos estão na escala interna 1–100; o jogo mostra `round(v / 5)`. Usar `attribute()` de `roles.ts`.
- Traits vêm como máscara hexadecimal em `attributes.traits`; descodificar com `decodePlayerTraits` (`lib/playerTraits.ts`).
- Condição física ao vivo: `stats.overallPhysicalCondition` (0–100). Pré-jogo: `profile.condition` (0–10000).
- Papéis vêm em inglês (`inPossession.role` / `outOfPossession.role`, ex.: "Advanced Playmaker", "Pressing Central Midfielder") e
  a posição exata em `inPossession.position` (ex.: `MCL`, `DCR`, `DMC`, `AMR`).
- `positionFamiliarities` está na escala 1–20.
- Momentum: valor positivo = equipa da casa.
- **Nomes**: em FM27 o plugin lê `shirtName` como textos da interface ("Mensagens", "25:13", "0 pts") para equipas inteiras.
  `sanitizedPlayerMetadata` em `api/realtimeMatch.ts` deteta isso por equipa e usa nome comum/apelido. A causa real está no plugin
  (offset do shirt name) — corrigir lá é uma tarefa em aberto.
- **Contra-pressão**: no log de eventos do FM as recuperações em ≤ 5 s são raras para ambas as equipas (~8%); usamos 8 s e
  limites calibrados (bom ≥ 25%, mau < 10%).
- **Alterações táticas**: o motor só aplica uma mudança na paragem de jogo seguinte (confirmado pelo dono). Em PT, os
  deveres "Defender"/"Atacar" têm o mesmo texto que duas mentalidades — por isso a mentalidade só é aceite em 3 padrões
  (número 1–7 ao lado do nome; barra redesenhada ≤ 2 s após `ConfirmTacticalChanges` com alvo `MatchTactic`; valor
  mostrado antes do jogo). O jogo também confirma sozinho no registo `match` (intervalo): ignorar.
- **Textos do jogo**: as traduções oficiais estão em `<FM27>/data/game_simulation/languages.fmf` (contentor zstd, não
  cifrado); `scripts/research/fm_translations.py` junta `portuguese.ltc` e `english.ltc` pelo id e diz o significado de
  um texto PT. Só acrescentar a `gameOptionLabels`/`playerInstructionTags` (uiTactic.ts) textos vistos no jogo ou cujas
  traduções inglesas apontem todas para a mesma opção. As táticas exportadas (`Documents/.../tactics/*.fmf`, magia
  `afe.`) estão cifradas — não ler.
- **Calibração**: os limiares das regras foram recalibrados com 9 jogos (18 atuações, `samples/`, nov.–dez. 2026). Medianas de referência:
  xG/remate 0,10 · cruzamentos certos 14% · ações ofensivas pelo centro 26% · altura média das ações defensivas 31%
  (a nossa pressão alta: 33–39%; nunca chega a 40%) · perdas no próprio terço ~8 por jogo com saída curta.
  Só há dados de UMA tática (teste2); recalibrar quando houver jogos com outras instruções.

## Comandos

```powershell
cd frontend
npm ci
npm run dev          # dashboard em modo de desenvolvimento
npm run typecheck    # tsc -b (o upstream tinha tsc --noEmit, que com o tsconfig raiz só de referências não verificava nada)
npm run lint
npx vitest run
npm run build        # gera frontend/dist (abrir dist/index.html diretamente funciona)

dotnet build src/FMMatchLens.Plugin/FMMatchLens.Plugin.csproj -c Release   # plugin (precisa de src/FMMatchLens.Plugin/lib, ver README)
```

Se `npm ci` ficar parado: o `package-lock.json` aponta muitos pacotes para `registry.npmmirror.com`. Substituir localmente por
`https://registry.npmjs.org` resolve (não fazer commit dessa alteração, para não divergir do upstream).

## Regras de trabalho

- Antes de dar uma tarefa como concluída: `npm run typecheck`, `npm run lint`, `npx vitest run` e `npm run build` sem erros.
- Ao mexer em regras do `engine.ts`, validar com ficheiros `.fmlens` reais (há exemplos em `samples/` se existirem; não fazer commit
  de `.fmlens` grandes) e confirmar que os números citados no texto batem com os dados.
- Texto das sugestões: concreto, com o número que o sustenta e a mudança exata a fazer no FM (nome da instrução como aparece no jogo em PT).
- Não reescrever código do upstream sem necessidade; preferir alterações pequenas e isoladas para facilitar `git merge` de novas versões.

## Próximos passos (roadmap)

1. **Tática ao vivo** — feito em parte (nov. 2026). A tática aplicada pelo motor não foi encontrada em memória (17 sessões,
   `docs/tactic-offsets.md`). Em vez disso, `Memory/TacticChangeTracker.cs` (opção `Tactics.TrackChanges`, ligada por
   omissão) lê o que a interface envia ao jogo (`GameInteropSubsystem.SendEvent` e `GamePlugin.PerformChannelActions`,
   via Harmony — **só métodos sem argumentos struct**, senão o jogo crasha) e regista: mentalidade (valor absoluto 1–7),
   mudanças rápidas de instruções de equipa (id `TacticTeamInstructions` + passos ±), passos de instruções individuais
   (jogador/instrução por descodificar), trocas/substituições e confirmações sem conteúdo identificado. O tick de
   aplicação (`appliedTick`) é a primeira paragem depois da escolha (bola fora ou parada 2 s). Gravado como registo
   `0x40` do `.fmlens` (JSON `{"v":1,"change":…}`, repetido quando é aplicado; leitores guardam o último por `sequence`)
   e exposto em `/api/match/tactics` e em `tacticChanges` de `/api/archives/{id}/frames`. No painel:
   `features/analysis/tacticChanges.ts` (tática efetiva = separador "Tática" + alterações; antes/depois por paragem) e
   separador "Alterações". Validado repetindo os logs reais das sessões 11–17 no rastreador (24/24 mentalidades).
   **Texto da interface**: ao desenhar instruções (painel de instruções rápidas, ecrã de táticas, painel de um jogador) a
   interface envia pares texto da opção + id de ícone (`tactic_icons-in-possession-tempo-var-higher`). O plugin grava-os
   em bruto (`uiValues`; os vistos antes do jogo como `initial`) e `features/analysis/uiTactic.ts` converte-os em valores
   absolutos (tabela ícone → instrução; texto → opção só para textos confirmados). O ícone identifica a instrução; o
   nome da variante nem sempre bate com a opção — o valor vem do texto.
   Menu de detalhe de uma instrução: escolher uma opção não envia evento; só redesenha o ícone do mosaico (sem texto),
   logo após o cartão de feedback com o nome interno da opção ("Backline Depth High") — o plugin grava o par com
   texto vazio + `optionKey`. `CancelPendingTacticalChanges` (1732789369) anula as alterações ainda não aplicadas
   (`cancelled`); `CancelTacticalChanges` (846559841) descarta os passos por confirmar.
   Falta: jogador das instruções individuais
   (`DynamicReference`), tática da IA, mais textos do jogo → opção na tabela `gameOptionLabels`.
2. Plugin: corrigir a leitura de `shirtName` em FM27.
3. ~~Análise de vários jogos diretamente a partir da API do plugin~~ — feito: botão "Carregar do plugin" no separador
   "Vários jogos" (`listServerArchives` / `analyseServerArchive` em `multiMatch.ts`; frames em páginas de 2 400, ~12 s por jogo).
4. Recalibrar limiares com 10+ jogos; comparar antes/depois de mudanças de instruções no mesmo jogo.
5. Separar a análise por fase do jogo e por estado do marcador (a ganhar / empatar / perder).
