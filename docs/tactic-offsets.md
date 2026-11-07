# Mapa da tática em memória (FM27)

Registo de onde estão a mentalidade, as instruções de equipa e as instruções individuais na memória do jogo.
É preenchido com a sonda `Research.TacticProbe` do plugin, mudando **uma** opção de cada vez.

Build do jogo usado: `game_plugin.dll` sha256 = `________` (aparece no `LogOutput.log` como "Detected game_plugin.dll").

## Preparar a sessão

1. Plugin compilado com a sonda copiado para `BepInEx/plugins/FMMatchLens/`.
2. Em `BepInEx/config/com.fmmatchlens.plugin.cfg`:

   ```ini
   [Research]
   TacticProbe = true
   ```

3. Abrir o jogo. O `LogOutput.log` mostra `Research.TacticProbe is ON; writing tactic memory diffs to ...`.
   O ficheiro fica em `BepInEx/plugins/FMMatchLens/data/research/tactic-probe-AAAAMMDD-HHMMSS.log`.
4. No fim da sessão voltar a pôr `TacticProbe = false`.

## Protocolo (sessão 17 — objetos por jogador do motor)

A mudança tática só é aplicada pelo motor **na paragem de jogo seguinte** (confirmado pelo utilizador). A sonda
`TacticObjects` segue os objetos apontados por `Team+0xF00…0x1600` das duas equipas: grava cada objeto completo no
fim da calibração e sempre que é realocado, e regista as palavras que mudam.

Preparação, em `[Research]`: **`TacticObjects = true`**, **`TacticEvents = true`** (deteta as escolhas de mentalidade
pelo nome); `TacticProbe`, `TacticScan`, `TacticPauseDiff` = `false`.

1. Deixa correr os **2 primeiros minutos de jogo** sem mexer.
2. Em cada passo: escolhe a mentalidade seguinte e deixa o jogo correr **até à paragem seguinte e mais uns segundos**
   (bola fora, falta, etc.), para o motor aplicar a mudança antes do passo seguinte.
3. Sequência (a partir de Positiva): Muito Defensiva → Defender → Cautelosa → Equilibrada → Positiva → Atacar →
   Muito Atacante → Atacar → Positiva → Equilibrada → Cautelosa → Defender → Muito Defensiva → (repõe Positiva).
4. Sem outras mudanças táticas nem substituições durante o varrimento.
5. Põe em `logs/` o `tactic-objects-*.log` e o `tactic-events-*.log`.

## Protocolo (sessão 16 — cópia do motor: varrimento da mentalidade)

Ideia: o motor converte a tática em **parâmetros por jogador** (na sessão 3 cada mudança de mentalidade recalculou em
bloco os dados de todos os jogadores). Um parâmetro assim tem de acompanhar a mentalidade **sempre no mesmo sentido**.
Percorrendo as 7 mentalidades a subir e a descer (13 passos), só os campos da tática passam esse teste.

Preparação, em `[Research]`: **`TacticProbe = true`** e **`TacticEvents = true`** (as duas ao mesmo tempo);
`TacticPauseDiff = false`, `TacticScan = false`. Não é preciso anotar horas: a escuta regista a hora exata de cada
confirmação.

1. Começa um jogo e deixa correr os **2 primeiros minutos de jogo** sem mexer (calibração da sonda).
2. Em cada passo: **pausa → muda a mentalidade → confirma → retoma** e deixa o jogo correr **pelo menos 30 s reais**
   (para o motor aplicar a mudança; se houver uma paragem de jogo nesse tempo, melhor).
3. Sequência (a partir de Positiva):
   Muito defensiva → Defensiva → Cautelosa → Equilibrada → Positiva → Ofensiva → Muito ofensiva →
   Ofensiva → Positiva → Equilibrada → Cautelosa → Defensiva → Muito defensiva → (no fim, repõe Positiva).
4. Não faças outras mudanças táticas durante o varrimento (substituições também não).
5. Põe em `logs/` os dois ficheiros: `tactic-probe-*.log` e `tactic-events-*.log`.

Análise: `python -I scripts/research/analyse_derived.py <probe> <events> 1,2,3,4,5,6,7,6,5,4,3,2,1 --from HH:MM:SS`
(`--from` = hora do 1.º passo; a reposição final em Positiva fica de fora com `--to`).

## Protocolo (sessões 9 e 10 — escuta do canal interface → jogo)

Preparação, em `[Research]`: **`TacticEvents = true`** e `TacticPauseDiff`, `TacticScan`, `TacticProbe` = `false`.
Copiar o DLL novo. No `LogOutput.log` deve aparecer `Research.TacticEvents is ON`; no início do
`data/research/tactic-events-*.log` devem aparecer linhas `Intercetado: …SendEvent(…)`. Se aparecer
`Nenhum método intercetado` ou o jogo crashar ao arrancar, põe `TacticEvents = false` e diz-me.

1. Entra num jogo e, **anotando a hora real de cada passo**, faz (pode ser em pausa ou com o jogo a correr):
   - Mentalidade: Positiva → **Muito defensiva** → **Positiva**;
   - Ritmo: Mais rápido → **Muito mais lento** → **Mais rápido**;
   - Remates do Aursnes: Padrão → **Rematar Menos** → **Padrão**;
   - uma **substituição** qualquer.
2. Deixa o jogo correr um pouco e sai.
3. Põe o `tactic-events-*.log` em `logs/` e manda-me as horas.

## Protocolo (sessões 6 a 8 — comparação em pausa)

O jogo fica **sempre em pausa**. Preparação, em `[Research]`: `TacticPauseDiff = true`, `TacticScan = false`,
`TacticProbe = false`.

Cada série tem **duas fotografias de base** (a 2.ª sem mudar nada — serve para descobrir o que muda sozinho) e depois
uma fotografia por mudança. O guião tem sempre **uma repetição** (o 1.º valor volta a aparecer no 3.º passo): é isso
que distingue a tática do ruído.

- **Ctrl+F9** = fotografia. As 3 primeiras de cada série demoram ~1 min (percorrem toda a memória); as restantes são
  rápidas. **Espera sempre pelo bip.**
- **Ordem em cada passo: primeiro mudas, depois carregas Ctrl+F9** (a fotografia regista o estado depois da mudança).
- No início de cada série são só **duas** Ctrl+F9 seguidas, sem mudar nada entre elas.
- Se o jogo pedir para confirmar a alteração tática, confirma — sem retomar o jogo.
- No fim, **Ctrl+F11** (dois bips quando acabar; pode demorar 2–3 min por causa da procura de ponteiros).
- Bip grave = tecla ignorada.

Exemplo completo — série 1 (Mentalidade, a começar em Positiva):

1. **Ctrl+F9** — base A
2. **Ctrl+F9** — base B (não mudas nada)
3. Mudas para **Muito defensiva** → **Ctrl+F9**
4. Mudas para **Muito ofensiva** → **Ctrl+F9**
5. Mudas para **Muito defensiva** → **Ctrl+F9**
6. Mudas para **Equilibrada** → **Ctrl+F9**
7. Mudas para **Positiva** → **Ctrl+F9**
8. **Ctrl+F11** — analisa

As outras séries seguem a mesma lógica (passos 1–2 iguais; a partir do 3: mudar → Ctrl+F9):

| Série | 1–2 | 3 | 4 | 5 | 6 | 7 | Fim |
|---|---|---|---|---|---|---|---|
| 1 — Mentalidade (Positiva) | Ctrl+F9 · Ctrl+F9 | Muito defensiva → Ctrl+F9 | Muito ofensiva → Ctrl+F9 | Muito defensiva → Ctrl+F9 | Equilibrada → Ctrl+F9 | Positiva → Ctrl+F9 | Ctrl+F11 |
| 2 — Ritmo (Mais rápido) | Ctrl+F9 · Ctrl+F9 | Muito mais lento → Ctrl+F9 | Muito mais rápido → Ctrl+F9 | Muito mais lento → Ctrl+F9 | Equilibrado → Ctrl+F9 | Mais rápido → Ctrl+F9 | Ctrl+F11 |
| 3 — Linha defensiva (Mais alta) | Ctrl+F9 · Ctrl+F9 | Muito mais baixa → Ctrl+F9 | Muito mais alta → Ctrl+F9 | Muito mais baixa → Ctrl+F9 | Equilibrada → Ctrl+F9 | Mais alta → Ctrl+F9 | Ctrl+F11 |
| 4 — Remates do Aursnes (Padrão) | Ctrl+F9 · Ctrl+F9 | Rematar Menos → Ctrl+F9 | Rematar Mais → Ctrl+F9 | Rematar Menos → Ctrl+F9 | Padrão → Ctrl+F9 | — | Ctrl+F11 |
| 5 — Marcação do Sudakov (Padrão) | Ctrl+F9 · Ctrl+F9 | Marcar mais em cima → Ctrl+F9 | Padrão → Ctrl+F9 | Marcar mais em cima → Ctrl+F9 | Padrão → Ctrl+F9 | — | Ctrl+F11 |

A partir da sessão 7 (ferramenta v3) a análise usa os **valores** do guião: um campo da tática tem de seguir
`valor = a × posição + b` (ex.: mentalidade 1, 7, 1, 4, 5). Por isso:

- faz as séries **pela ordem 1 → 5**, cada uma com **exatamente** os passos da tabela (a ferramenta sabe que série é
  pela ordem; se te enganares numa série, reinicia o jogo e recomeça na série 1);
- a 3.ª fotografia de cada série pode ocupar até ~0,7 GB de memória durante alguns segundos; depois vai encolhendo.

No fim põe `data/research/tactic-pausediff-*.log` em `logs/`.

## Abordagem A — o que a interface do jogo revela (análise das DLLs de interop, sem jogo)

Ferramenta: leitura de metadados das DLLs em `BepInEx/interop` (nunca carregadas nem executadas).

- A interface **não guarda a tática em C#**: guarda referências (`InteropReference`, `MatchTacticReference`,
  `UiRecordID.MatchTactic = 64`, `TeamTactic = 126`, `Tactic = 113`) e recebe os valores do motor nativo por
  "canais" de propriedades (`ChannelData.property`, `EventFmxRequestPropertyUpdate`). A API de bindings é
  assíncrona e presa ao ciclo da interface — não serve para ler diretamente.
- Mudanças a meio do jogo: `HasPendingTacticalChanges`, `CanSyncApplyNewTacticalChanges(MatchStopReason)` —
  confirmam que só são aplicadas numa paragem.
- **Enums oficiais (FM.UI)** — a codificação que o descodificador vai usar:
  - `TacticMentalities`: None 0 · VeryDefensive 1 · Defensive 2 · Cautious 3 · Balanced 4 · Positive 5 · Attacking 6 · VeryAttacking 7.
  - `TacticTeamInstructions` (0–32): Formation, PassingDirectness, PassingVerticality, AttackingTransition, TeamWidth,
    CreativeFreedom, PlayForSetPieces, TimeWasting, LineOfEngagement, DefensiveLine, PressingTrigger,
    DefensiveTransition, Tackling, TacticalStyle, Mentality, DefensiveLineBehaviour, GoalkeeperDistributionTarget,
    GoalkeeperDistributionSpeed, Patience, Dribbling, PassReception, Tempo, CrossEngagement,
    PreventShortGKDistribution, BuildUpStrategy, PressingTrap, CrossingStyle, ShotsFromDistance, SupportingRuns,
    GoalKicks, ProgressThrough, SupportingRunsSecondary, GoalkeeperUpForAttackingSetPieces.
  - `TacticTeamInstructionOptions`: **103 IDs de 32 bits únicos** (ex.: HigherTempo `0x50304232`,
    PlayThroughPress `0x5169534C`, LineOfEngagementHigh `0x79355343`). Tabela completa em
    `src/FMMatchLens.Plugin/Memory/TacticSignatureScan.cs`.
  - `PlayerInstruction` (0–42, ex.: PI_SHOOT_LESS 19, PI_MARK_TIGHTER 33) e `PlayerInstructionGrouping` (0–16:
    AttackingWidth … AttackBoxDepth — os 17 cartões do ecrã de instruções individuais).
  - `TeamInstructionPhaseID`: InPossessionDefault 0, FinalThird 1, Progression 2, BuildUp 3,
    OutOfPossessionDefault 4, HighPress 5, MidBlock 6, LowBlock 7, …

## Protocolo (sessão 4 — pesquisa por assinatura)

Como os IDs das opções são únicos, o plugin procura-os na memória e encontra a tática sem protocolo de mudanças.

1. Em `com.fmmatchlens.plugin.cfg`, secção `[Research]`: `TacticScan = true` e **`TacticProbe = false`**
   (o log da sonda já não é preciso e pesa muito).
2. Joga um jogo normalmente até **pelo menos ao minuto 55**. O plugin faz duas pesquisas, aos minutos 2 e 50,
   cada uma com alguns segundos numa thread de fundo (pode haver um pequeno soluço).
3. **Ao intervalo**, muda o **Ritmo** de "Mais rápido" para "Muito mais lento" (para a 2.ª pesquisa mostrar que
   bloco mudou). Opcional: mudar também a mentalidade.
4. Manda-me `BepInEx/plugins/FMMatchLens/data/research/tactic-scan-*.log` (põe-no em `logs/`).

## Protocolo (sessão 3 — sonda v3)

A sonda v3 **regista tudo** o que muda (exceto o que se comporta como estado do jogo) e já não depende de detetar
pausas. A correspondência com o guião faz-se pelas **horas reais que anotares** — como na sessão 2, que funcionou.

Regras:

1. Começa um jogo e **não pauses nem mexas em nada nos primeiros 2 minutos de jogo** (calibração).
2. Em cada passo: pausa → faz **só** essa mudança → retoma → **anota a hora real**.
3. Deixa passar **pelo menos 30 s reais** entre passos (a sonda trata como estado do jogo o que mudar 6 vezes em 2 min).
4. Ao intervalo não mudes nada.
5. Opcional, mas muito útil: antes do jogo tira uma foto das **instruções individuais** de cada posição (ou
   escreve-as). A sonda grava no início as flags e listas de cada jogador e eu comparo com isso.

| Passo | Mudança | Hora real |
|---|---|---|
| 1 | Mentalidade: Positiva → **Muito defensiva** | |
| 2 | Linha defensiva: Mais alta → **Muito mais baixa** | |
| 3 | Ritmo: Mais rápido → **Muito mais lento** | |
| 4 | Mentalidade: → **Muito ofensiva** | |
| 5 | Linha defensiva: → **Muito mais alta** | |
| 6 | Ritmo: → **Muito mais rápido** | |
| 7 | Mentalidade: → **Equilibrada** | |
| 8 | Linha defensiva: → **Mais alta** (repor) | |
| 9 | Ritmo: → **Mais rápido** (repor) | |
| 10 | Mentalidade: → **Positiva** (repor) | |
| 11 | MCR (Aursnes), com bola: Remates **Padrão → Rematar Menos** | instrução individual com bola ("Risco do passe" está bloqueado pela função) |
| 12 | MCL (Sudakov): marcação → **Marcar mais em cima** | controlo (já conhecido: `+0xE04`) |
| 13 | MCR (Aursnes), com bola: Remates **→ Padrão** (repor) | |
| 14 | MCL (Sudakov): marcação → **Padrão** | |
| 15 | Bloco / linha de pressão: Pressão alta → **Bloco baixo** | |
| 16 | Bloco / linha de pressão: → **Pressão alta** (repor) | |

Se algum valor inicial for diferente do indicado, faz a mudança na mesma e repõe o teu valor no passo de "repor".

## Guião da sessão 2 (arquivo)

A sonda deteta e **numera as pausas sozinha** (`⏸ PAUSA #k` / `▶ RETOMA #k`) e só regista o que muda nos 20 s
a seguir a cada retoma. Por isso não precisas de anotar horas: a **pausa n.º k é o passo k do guião**.

Regras:

1. Começa um jogo e **não pauses nem mexas em nada nos primeiros 2 minutos de jogo** (calibração).
2. Em cada pausa faz **exatamente uma** mudança — o passo seguinte do guião — e retoma.
3. Depois de retomar, deixa o jogo correr **pelo menos 2 minutos de jogo** antes da pausa seguinte.
4. **Intervalo:** não mudes nada ao intervalo; continua o guião na pausa seguinte (eu identifico a pausa do
   intervalo pelo minuto 45). O mesmo se pausares sem querer: retoma sem mexer e continua.
5. Se não chegares ao fim do guião num jogo, diz-me em que passo ficaste.

| Passo | Mudança | Para quê |
|---|---|---|
| 1 | Função com posse de bola do MCR (Aursnes): Médio De Construção → **Médio Centro** | controlo: já sabemos que muda `Jogador … +0x0DB0` |
| 2 | Função com posse de bola do MCR: repor **Médio De Construção** | controlo: tem de voltar ao valor inicial |
| 3 | Mentalidade: Positiva → **Ofensiva** | |
| 4 | Mentalidade: → **Muito ofensiva** | |
| 5 | Mentalidade: → **Equilibrada** | |
| 6 | Mentalidade: → **Cautelosa** | |
| 7 | Mentalidade: → **Defensiva** | |
| 8 | Mentalidade: → **Muito defensiva** | |
| 9 | Mentalidade: → **Equilibrada** | verificação: tem de dar o mesmo valor que o passo 5 |
| 10 | Mentalidade: → **Positiva** (repor) | |
| 11 | Linha defensiva: Mais alta → **Muito mais alta** | |
| 12 | Linha defensiva: → **Equilibrada** | |
| 13 | Linha defensiva: → **Muito mais baixa** | |
| 14 | Linha defensiva: → **Mais alta** (repor) | |
| 15 | Bloco / linha de pressão: Pressão alta → **Bloco médio** | |
| 16 | Bloco / linha de pressão: → **Bloco baixo** | |
| 17 | Bloco / linha de pressão: → **Pressão alta** (repor) | |
| 18 | Ritmo: Mais rápido → **Muito mais lento** | |
| 19 | Ritmo: → **Mais rápido** (repor) | |
| 20 | Largura ofensiva: Muito mais estreita → **Muito mais larga** | |
| 21 | Largura ofensiva: → **Muito mais estreita** (repor) | |
| 22 | Transição defensiva: Contra-pressão → **Reagrupar** | |
| 23 | Transição defensiva: → **Contra-pressão** (repor) | |
| 24 | MCL (Sudakov): **mudar a marcação** para **Marcar mais em cima** | instrução individual; "Pressionar com mais frequência" está bloqueado pela função sem bola |
| 25 | MCL (Sudakov): **repor a marcação** original | |
| 26 | Pressionar saída curta do GR: Sim → **Não** | |
| 27 | Pressionar saída curta do GR: → **Sim** (repor) | |

No fim manda-me o ficheiro `tactic-probe-*.log`. Depois de cada janela o log imprime a lista cumulativa de
**candidatas** — palavras que mudaram só depois de pausas e nunca com o jogo a correr sozinho.

Ler cada linha de alteração:

```
[21:14:03 23:41 tick 5689] #4 Team[casa] +0x0FA0  0D050E003200010D → 0D050E003200010A  xor 7  bytes [+0: 13→10]
                           passo região    offset  valor antigo        valor novo        bits   bytes que mudaram
```

## Verificações finais

- [ ] No pontapé de saída, os valores lidos correspondem à tática `teste2` (`defaultTacticProfile` em
      `frontend/src/features/analysis/tacticProfile.ts`).
- [ ] 10 minutos sem mexer: nenhum dos offsets mapeados muda.
- [ ] Instruções individuais: trocar dois jogadores de posição e fazer uma substituição; anotar se a instrução
      segue a **posição** ou o **jogador**.
- [ ] Tempo entre a mudança no ecrã e a mudança na memória (imediata, ao retomar, ou só na paragem seguinte).
- [ ] Repetir 2–3 opções noutro jogo e depois de reiniciar o FM: os offsets mantêm-se.
- [ ] A equipa adversária (IA) tem os mesmos offsets (ver uma mudança de mentalidade da IA, se acontecer).

## Mentalidade e estilo

| Opção | Valor inicial | Valores a percorrer | Região | Offset | Codificação (valor → opção) |
|---|---|---|---|---|---|
| Mentalidade | Positiva | Muito defensiva → Defensiva → Cautelosa → Equilibrada → Positiva → Ofensiva → Muito ofensiva | | | |
| Estilo | Tiki-Taka Vertical | (pode não estar no motor) | | | |

## Instruções de equipa

Valor inicial = tática `teste2`.

| Fase | Instrução | Valor inicial | Valores a percorrer | Região | Offset | Codificação (valor → opção) |
|---|---|---|---|---|---|---|
| Com bola | Transição ofensiva | Contra-ataque | Manter posições → Equilibrada → Contra-ataque | | | |
| Com bola | Largura ofensiva | Muito mais estreita | Muito mais estreita → Mais estreita → Equilibrada → Mais larga → Muito mais larga | | | |
| Com bola | Estratégia de construção | Jogar através da pressão | Jogar através da pressão → Equilibrada → Contornar a pressão | | | |
| Com bola | Liberdade criativa | Equilibrada | Mais disciplina → Equilibrada → Mais expressão | | | |
| Com bola | Tipo de cruzamento | Rasteiros | Rasteiros → Equilibrado → Tensos → Altos | | | |
| Com bola | Drible | Encorajar | Desencorajar → Equilibrado → Encorajar | | | |
| Com bola | Distribuição do GR (alvo) | Centrais | Centrais → Laterais → Criativo → Equilibrada → Avançado alvo → Extremos | | | |
| Com bola | Distribuição do GR (velocidade) | Equilibrada | Lenta → Equilibrada → Rápida | | | |
| Com bola | Pontapés de baliza | Curtos | Curtos → Equilibrados → Longos | | | |
| Com bola | Sobreposição | Esquerda | Nenhuma → Esquerda → Direita → Ambas | | | |
| Com bola | Desdobramento por dentro | Direita | Nenhum → Esquerda → Direita → Ambos | | | |
| Com bola | Receção do passe | Equilibrada | No pé → Equilibrada → No espaço | | | |
| Com bola | Tipo de passe | Mais curto | Muito mais curto → Mais curto → Equilibrado → Mais direto → Muito mais direto | | | |
| Com bola | Paciência | Trabalhar a bola até à área | Trabalhar a bola até à área → Equilibrada → Cruzar mais cedo | | | |
| Com bola | Bolas paradas | Manter a bola em jogo | Manter a bola em jogo → Equilibrado → Procurar bolas paradas | | | |
| Com bola | Progredir por | Meio | Esquerda → Meio → Direita → Equilibrado → Alas | | | |
| Com bola | Remates de longe | Equilibrado | Menos → Equilibrado → Mais | | | |
| Com bola | Ritmo | Mais rápido | Muito mais lento → Mais lento → Equilibrado → Mais rápido → Muito mais rápido | | | |
| Com bola | Queimar tempo | Menos vezes | Menos vezes → Equilibrado → Mais vezes | | | |
| Sem bola | Oposição aos cruzamentos | Equilibrado | Impedir cruzamentos → Equilibrado → Convidar cruzamentos | | | |
| Sem bola | Linha defensiva | Mais alta | Muito mais baixa → Mais baixa → Equilibrada → Mais alta → Muito mais alta | | | |
| Sem bola | Comportamento da linha | Equilibrado | Recuar → Equilibrado → Subir / fora de jogo | | | |
| Sem bola | Transição defensiva | Contra-pressão | Reagrupar → Equilibrada → Contra-pressão | | | |
| Sem bola | Bloco / linha de pressão | Pressão alta | Bloco baixo → Bloco médio → Pressão alta | | | |
| Sem bola | Armadilha de pressão | Equilibrada | Forçar para dentro → Equilibrada → Forçar para fora | | | |
| Sem bola | Pressionar saída curta do GR | Sim | Não → Sim | | | |
| Sem bola | Desarme | Normal | Ficar de pé → Normal → Entrar com força | | | |
| Sem bola | Frequência de pressão | Mais vezes | Menos vezes → Equilibrada → Mais vezes | | | |

## Instruções individuais

Começar por **um** jogador (ex.: o MCL) e por instruções que existam com e sem bola. Candidato principal: o bloco
tático do `MatchPlayer` (com bola `0xD70`–`0xDFF`, sem bola `0xE00`–`0xE8F`), nos bytes entre a posição e a função.

| Posição | Instrução | Antes → depois | Região | Offset | Bits | Segue posição ou jogador? |
|---|---|---|---|---|---|---|
| MCL | Fazer menos corridas | ligado → desligado | | | | |
| MCL | Rematar menos | ligado → desligado | | | | |
| MCL | Correr mais riscos no passe | ligado → desligado | | | | |
| MCL | Marcação (passos 24–25) | Padrão → Marcar mais em cima → Padrão | Jogador (sem bola) | `+0xE04` (u32 alto de `+0xE00`) | `0` → `0x80000500` → `0x01000000` | posição (a confirmar) |
| MCL | Pressionar com mais frequência | bloqueado pela função sem bola (Pressing CM) | — | — | — | — |
| DM | Marcar mais apertado | ligado → desligado | | | | |
| DM | Desarmar com mais força | ligado → desligado | | | | |
| ST | Segurar a bola | ligado → desligado | | | | |


## Instruções individuais de partida (fotos antes do Benfica–Nacional, 27 dez)

Tática `teste2`, estilo Tiki-Taka Vertical, mentalidade **Positiva**. "Aplicar a: Posição" em todas.
Só os valores diferentes de Normal/Padrão/Não; 🔒 = bloqueado pela função ("Instrução Indisponível").
Com bola tem 13 instruções (Largura ofensiva, Direção da finta, Frequência da finta, Desmarcações, Liberdade de
movimento, Segura a bola, Remates, Risco do passe, Estratégia de passe, Cruzamento de, Estratégia de cruzamento,
Atacar a área – I, Atacar a área – P); sem bola tem 4 (Iniciar pressão, Marcação, Desarme, Alvo a marcar).

| Posição (ecrã) | Função com bola | Com bola (não-padrão) | Função sem bola | Sem bola (não-padrão) |
|---|---|---|---|---|
| Guarda-redes | GR de Construção | Liberdade 🔒 Respeitar o posicionamento · Risco do passe 🔒 Correr Mais Riscos | Guarda-Redes | — (tudo 🔒) |
| Defesa (Esquerdo) — Dahl | Defesa Lateral | Frequência da finta: Fintar Menos · Remates: Rematar Menos · Estratégia de cruzamento: Avançado Alvo · Liberdade 🔒 Respeitar o posicionamento | Lateral De Contenção | Iniciar pressão 🔒 Com Menor Frequência |
| Defesa (Centro) ×2 — Lenglet, T. Araújo | Central De Construção | Desmarcações 🔒 Fazer menos corridas · Liberdade 🔒 Respeitar o posicionamento · Risco do passe 🔒 Correr Mais Riscos | Defesa Central | — |
| Defesa (Direito) — Bah | Ala | Frequência da finta: Fintar Menos · Remates: Rematar Menos · Desmarcações 🔒 Fazer Mais Arrancadas · Liberdade 🔒 Respeitar o posicionamento | Defesa Lateral | — |
| Médio defensivo — Palhinha | Médio Defensivo | Remates: Rematar Menos · Risco do passe: Correr Menos Riscos · Estratégia de passe: Mais curtos · Frequência da finta 🔒 Fintar Menos · Desmarcações 🔒 Fazer menos corridas · Liberdade 🔒 Respeitar o posicionamento | Médio Defensivo | Marcação: Marcar Mais em cima · Desarme: Desarme Mais forte |
| Médio (Centro) MCL — Sudakov | Construtor De Jogo Avançado | Desmarcações: Fazer menos corridas · Remates: Rematar Menos · Risco do passe 🔒 Correr Mais Riscos · Atacar a área – P 🔒 Chegar tarde à área | Médio Trabalhador | Iniciar pressão 🔒 Com Mais Frequência |
| Médio (Centro) MCR — Aursnes | Médio De Construção | Risco do passe 🔒 Correr Mais Riscos | Médio Centro | — |
| Médio ofensivo (Esquerdo) — Prestianni | Avançado Interior | Largura: Encurtar Linhas · Direção da finta: Cortar Para Dentro · Frequência da finta: Fintar Mais · Desmarcações 🔒 Fazer Mais Arrancadas · Atacar a área – P 🔒 Atacar linha defensiva | Médio Ala | — |
| Médio ofensivo (Direito) — Schjelderup | Avançado Aberto | Largura: Encurtar Linhas · Frequência da finta: Fintar Mais · Risco do passe: Correr Menos Riscos · Estratégia de passe 🔒 Mais curtos · Desmarcações 🔒 Fazer Mais Arrancadas · Atacar a área – P 🔒 Atacar linha defensiva | Médio Ala | — |
| Ponta-de-lança (Centro) — Pavlidis | Avançado Recuado | Segura a bola 🔒 Sim | Avançado Esforçado | — |

Notas: MCL e MCR aparecem ambos como "Médio (Centro)" mas têm funções e instruções diferentes — a "posição" é o
lugar no esquema. Várias instruções que a tática `teste2` do painel tratava como escolhas (ex.: "pressionar mais"
do MCL, "arriscar mais" do MCR) vêm afinal **da função** (🔒).

## Notas da sessão

### Sessão 1 — 2026-11-06, Benfica (casa), minutos 0–34, `tactic-probe-20261106-012443.log`

- Nenhum objeto com RTTI de tática apontado pelo `GameMatch` ou pela equipa (só `MATCH_PLAYER`, `INJURY`,
  `TEAM@db`, `CITY@db`, `GAME_MATCH_MANAGER`, `GAME_MATCH_STATS`, árbitros).
- **Durante as pausas nada muda** nas regiões observadas: as mudanças só chegam à memória do motor ao retomar.
- Bloco tático dos jogadores (`0xD70`–`0xEFF`) nunca mudou. `0xD20`/`0xDB8`/`0xDF8` mudam aos pares entre dois
  jogadores e revertem em segundos — parece posicionamento em bolas paradas, não instruções.
- Pistas a confirmar: `Team+0xF00`–`0xFF8` (tabela de bytes pequenos — ex. `+0xFA0`: 9→10→13→10→9 — e uma lista
  de ponteiros que continua para lá de `0x1000`), e listas em `Team+0xF18`/`+0xF40` criadas e esvaziadas à volta
  das pausas. A estrutura da equipa é maior do que `0x1000`.
- Não foi possível ligar alterações a mudanças concretas (horas não anotadas) → sessão 2 com guião numerado e
  pausas detetadas pela sonda.

### Sessão 2 — 2026-11-06, Benfica (casa), jogo completo, passos 1–25, `tactic-probe-20261106-015352.log`

Correspondência passo → hora real (dada pelo utilizador, corrigida com o log): 1 02:03:05 · 2 02:04:20 · 3 02:05:42 ·
4 02:06:55 · 5 02:07:53 · 6 02:08:20 · 7 02:08:50 · 8 02:09:45 · 9 02:10:40 · 10 02:11:30 · 11 02:12:07 · 12 02:13:15 ·
13 02:13:45 · 14 02:14:20 · 15 02:14:52 · 16 02:15:17 · 17 02:15:40 · 18 02:16:46 · 19 02:17:12 · 20 02:17:37 ·
21 02:18:12 · 22 02:18:50 · 23 02:19:12 · 24 02:21:03 · 25 02:21:35. Pausas da sonda: #1–#5 = passos 1–5, #6 = 7,
#7 = 11, #8 = intervalo, #9 = 13, #10 = 14, #11 = 15, #12 = 16, #13 = 18, #14 = 20, #15 = 21, #16 = 22, #17 = 23,
#18 = 24, #19 = 25. Os passos 6, 8, 9, 10, 12, 17 e 19 tiveram pausas < 4 s e não foram registados.

Confirmado:

- **Função com bola (controlo, passos 1–2):** `MatchPlayer+0xDB0` do MCR passou de `0x0200000000000000` (Médio De
  Construção) para `0x20` (Médio Centro) e voltou. Só o MCR mudou → a função é da posição, não afeta o MCL. A mudança
  só chegou à memória ~27 s de jogo depois de retomar.
- O mesmo bloco aparece em **três cópias**: `+0xD20/+0xD28`, `+0xD68/+0xD70`, `+0xDB0` (função) — provavelmente
  atual / pedida / base.
- **A palavra da posição tem duas metades:** u32 baixo = máscara de posição (o que o plugin já lê); **u32 alto =
  flags**. No passo 1 o u32 alto de `+0xD70` ganhou `0x200`.
- **Marcação (passos 24–25, MCL Sudakov):** u32 alto da palavra da posição **sem bola** `+0xE00`:
  `00000000` (por omissão) → `80000500` ("Marcar mais em cima") → `01000000` ("Padrão" escolhido
  explicitamente). O jogo distingue "nunca mexido" de "Padrão": o descodificador deve tratar `0` e `0x01000000` como Padrão.
- Na mesma mudança a lista `MatchPlayer+0xE08/+0xE10/+0xE18` (início/fim/capacidade) foi realocada e cresceu
  48 bytes; há uma lista equivalente com bola em `+0xDC0/+0xDD0`. Candidata a lista de instruções individuais.

Não encontrado: mentalidade, linha defensiva, bloco, ritmo, largura, transição. Causa provável (defeito da sonda v2):
só registava nas janelas a seguir a pausas ≥ 4 s e descartava como "estado do jogo" tudo o que mudasse fora delas —
incluindo as mudanças dos passos com pausas curtas.

### Sessão 3 — 2026-11-06, Benfica–Nacional, passos 1–16, sonda v3, `tactic-probe-20261106-023542.log`

Horas reais dos passos: 1 02:44:54 · 2 02:46:15 · 3 02:47:05 · 4 02:47:45 · 5 02:48:40 · 6 02:49:22 · 7 02:50:04 ·
8 02:50:59 · 9 02:51:49 · 10 02:52:27 · 11 02:55:10 · 12 02:56:00 · 13 02:56:48 · 14 02:57:42 · 15 02:58:26 ·
16 02:59:21.

- Nenhuma palavra nas regiões observadas (GameMatch, Team até `0x3000`, treinador = `GAME_MATCH_MANAGER`,
  `TEAM@db`, `TeamBase`, blocos por jogador, todas as listas início/fim/capacidade) acompanha a mentalidade, a
  linha, o ritmo ou o bloco de forma consistente.
- `Team+0x4E0` (lista realocada nos passos 1, 4, 7) é estado do jogo: cresce sozinha (64→384 bytes) e contém
  coordenadas e ticks.
- Marcação do Sudakov (passos 12, 14): volta a mudar o u32 alto de `+0xE00`, mas com valores diferentes da sessão 2
  (`0C875300`→`00007F00`→`4AE2D100`) → são bytes de enchimento reescritos com o bloco, **não** o valor da instrução.
  O facto útil é que o bloco do jogador é reescrito quando muda uma instrução individual.
- Conclusão: a tática (mentalidade, instruções de equipa e individuais) **não está** nas estruturas do motor
  alcançáveis a partir do jogo/equipa/jogadores que a sonda observa. Próximo passo: procurar no modelo de tática
  da interface (IL2CPP, `FM.UI`) e/ou comparar a memória inteira com o jogo em pausa.

### Sessão 4 — 2026-11-06, pesquisa por assinatura, `tactic-scan-20261106-031438.log`

- 1.ª pesquisa (minuto 2): 10 GB de memória privada, 3 848 ocorrências de IDs de opções, 100 s. A 2.ª (minuto 50)
  ficou incompleta (o jogo foi fechado durante a pesquisa).
- Os 14 blocos encontrados são **tabelas de definição da interface** (todas as opções de cada instrução, com passo
  regular 0x10/0x30/0x60/0xCC) ou **predefinições de estilos** (uma opção por instrução, mas que não correspondem à
  tática do utilizador — ex.: bloco com MuchHigherTempo, PassingStyleMuchMoreDirect, HitEarlyCrosses).
- Conclusão: **a tática ativa não é guardada com os IDs `TacticTeamInstructionOptions`** — esses IDs são da camada da
  interface. Hipótese excluída.
- Pista nova (metadados de `FM.GamePlugin`): o canal entre interface e motor é
  `GamePlugin.SendEvent(UInt32 evento, InteropReference alvo, TypedValue valor)` (interface → motor: cada alteração
  feita pelo utilizador) e `GameReceiver.SendDataResponse(Span<UInt64> chaves, Span<Byte> dados)` (motor → interface:
  valores das propriedades pedidas, incluindo os registos `MatchTactic`).

### Sessão 5 — 2026-11-06, comparação em pausa v1, `tactic-pausediff-20261106-200700.log`

- Sem resultado útil, por defeitos da ferramenta v1: (1) em pausa ~120 000 páginas mudam na mesma (interface a
  desenhar; bytes que alternam 0/1 a cada fotografia) e o limite de páginas foi atingido em todas as séries; (2) a
  análise ordenava os candidatos de forma genérica e só registou 300 de milhões — todos alternâncias 0/1; (3) o
  historial byte a byte fez a memória do processo crescer de 10 para ~30 GB.
- v2: duas bases para excluir o que muda sozinho, guiões com repetição e análise por padrão de valores (`ABACD`),
  cópias por página em vez de objetos por byte.

### Sessão 6 — 2026-11-06, comparação em pausa v2, `tactic-pausediff-20261106-210349.log`

- Em pausa mudam sozinhas 64–126 mil páginas entre as duas bases; entre a base B e a 1.ª mudança mudam mais 60–100 mil
  páginas "limpas" (abrir/mexer no ecrã de táticas aloca e redesenha muita coisa). O limite de 25 000 páginas foi
  atingido em todas as séries.
- O padrão `ABACD` aparece em 9 a 79 mil bytes por série — quase todo memória reciclada (0 → X → 0 → Y → Z); só 40 por
  padrão ficaram no log. Nenhum candidato com valores pequenos coerentes com a escala da mentalidade nos registados.
- v3: verificação linear com os valores do guião (byte, sbyte, int16, int32, float, IDs de opção), até 160 000 páginas
  com poda a cada passo (só ficam as que mudam em todos os passos), todos os candidatos registados.

### Sessão 7 — 2026-11-06, comparação em pausa v3, `tactic-pausediff-20261106-213254.log`

- A poda funciona: de ~145 000 páginas na 1.ª mudança ficam ~24 000 no fim de cada série.
- A verificação linear é seletiva: mentalidade → **21 bytes + 4 bytes com sinal**; ritmo → 25 + 17 + 3 int16;
  linha → 52 + 15. Remates (4 passos, 3 valores) e marcação (2 valores) são muito menos seletivos, como esperado.
- Mas os candidatos inteiros **não ficaram no log**: o registo tinha 400 linhas e punha os float primeiro, e a
  verificação float aceitava valores quase constantes (dezenas de milhares de falsos positivos). Também a procura de
  ponteiros usou esses floats.
- v3.1: inteiros primeiro com limite por tipo; float exige valores repetidos bit-a-bit iguais e variação real;
  contexto em hexadecimal à volta dos candidatos; aviso "PERTO" quando candidatos de séries diferentes ficam a menos
  de 0x400 bytes (mentalidade, ritmo e linha devem estar na mesma estrutura). Funções de decisão testadas com 14 casos.

### Sessão 8 — 2026-11-06, comparação em pausa v3.1, `tactic-pausediff-20261106-220117.log` (séries 1–3)

- **Valores encontrados** (fora dos blocos densos da interface):
  - Mentalidade: bytes `[0 6 0 3 4]` em `0x201F007E8A8` e `0x203255848A5` → **índice 0–6** (Muito defensiva = 0 …
    Muito ofensiva = 6; Positiva = 4); e `[2 8 2 5 6]` em `0x202C15C841C`.
  - Ritmo: byte com sinal `[-2 2 -2 0 1]` em `0x202C1591C38` → **−2 … +2** (Equilibrado = 0); vários `[0 4 0 2 3]`.
  - Linha defensiva: byte com sinal `[-2 2 -2 0 1]` em `0x2052FF765A4` → **−2 … +2**.
- Centenas de `[0 4 0 2 3]` em blocos densos (`0x200ABAEF…`, `0x200ABB2B…`, `0x200ABF4F…`) = interface a desenhar.
- **Mas** estes valores parecem estar do lado da interface / canal de dados: o contexto de `0x202C1591C38` tem o
  aspeto de valores serializados (marcadores `…C0`), o de `0x201F007E8A8` uma lista de inteiros (índice selecionado de
  uma lista). Nenhum ponteiro a partir do `game_plugin.dll` ("RAIZ ESTÁVEL") até 2 níveis. Em pausa a alteração ainda
  está "pendente": a cópia do motor só muda ao retomar (sessão 1).
- Codificações aprendidas (úteis para qualquer abordagem): mentalidade = índice 0–6; instruções de 5 níveis = −2…+2.

### Sessão 9 — 2026-11-06, escuta `SendEvent` (Harmony), `tactic-events-20261106-222737.log`

- **A interceção funciona e o jogo não crashou** (Harmony sobre `GamePlugin.SendEvent` e
  `GameInteropSubsystem.SendEvent`, encontrados por reflexão).
- Registos: `TeamTactic:2003981123` (antes do jogo) e `MatchTactic:2003981124` (durante o jogo).
- Ritmo → Muito mais lento: 3× `EventFmxQuickChangeTacticInstructionDecrement` com **valor 21** (=
  `TacticTeamInstructions.Tempo`); voltar: 3× `…Increment`. Ou seja, as instruções de equipa vão como passos ±1,
  não como valor absoluto.
- Remates do Aursnes: `EventFmxQuickChangePlayerInstructionDecrement/Increment` com um `DynamicReference` (falta
  descodificar jogador/instrução).
- Substituição: `EventFmxSwapPlayers`. Cada confirmação: `EventFmxConfirmTacticalChanges` (valor True) +
  `EventFmxTacticsScreenClosed`, com hora e minuto exatos. Antes: `EventFmxModifyPendingTacticalChanges` /
  `EventFmxMakingTacticalChanges`.
- **Mentalidade: nenhum evento** — passa por outro caminho. Candidatos encontrados nos metadados:
  `GameInteropSubsystem.OpenChannel(InteropReference, PropertyID, Key)` (a interface subscreve uma propriedade),
  `UpdateChannelData(Key, TypedValue)` e `SetData(DataKey, TypedValue)` (a interface escreve), e
  `GameReceiver.OnChannelDataChange(ReadOnlySpan<UInt64>, List<TypedValue>, ReadOnlySpan<Int64>)` (dados do motor).
- Sessão 10: escuta alargada a `OpenChannel` (só registos de tática/jogo), `UpdateChannelData` e `SetData`, com
  cada escrita anotada com a propriedade do canal.

### Sessão 10 — 2026-11-06, escuta alargada → **crash**

- O jogo crashou logo após a primeira chamada intercetada de `GameInteropSubsystem.SetData(DataKey, TypedValue)`
  (`tactic-events-20261106-223845.log`). Causa: o Harmony em IL2CPP corrompe argumentos que são **estruturas**
  (`DataKey`, `Key`, `PropertyID`, `ChannelAction`, `Span`). `SendEvent` (uint + objetos) funcionava.
- Correção: a escuta só interceta métodos cujos parâmetros sejam primitivos, enums ou objetos (`IsSafeToPatch`);
  `OpenChannel`, `UpdateChannelData` e `SetData` ficam excluídos.
- Nova via (sessão 11): funções auxiliares da interface que recebem a tática como objeto —
  `TacticalTweakVisualFunctions.IsAnyTeamInstructionTweaked/IsAnyTeamInstructionPending(TypedValue)` — e, com esse
  objeto, chamar `TryGetBaselineOption(tática, instrução, out opção)` para as 33 instruções (valores absolutos);
  mentalidade via `TacticalTweakData.MentalityValueTranslationID(TacticMentalities)`.

### Sessão 11 — 2026-11-06, escuta segura + funções auxiliares, `tactic-events-20261106-224341.log`

- Sem crash. `SendEvent` volta a mostrar ritmo (3× Decrement/Increment da instrução 21), remates do Aursnes
  (`QuickChangePlayerInstruction…`), substituição (`SwapPlayers`) e cada `ConfirmTacticalChanges`.
- `IsAnyTeamInstructionTweaked/Pending` e `MentalityValueTranslationID` **nunca foram chamadas** no ecrã normal de
  táticas — pertencem à funcionalidade de "ajustes rápidos" (tactical tweaks).
- Mentalidade: só aparece um `ConfirmTacticalChanges` sem mais nenhum evento (22:46:25 e 22:46:50).
- Sessão 12: escuta de `GameInteropSubsystem.PerformChannelActions(List<ChannelAction>, List<…>)` (listas → seguro),
  onde a interface envia em lote as escritas nos canais; descrição de campos de estruturas e do `DynamicReference`.
- Plano B se a mentalidade não aparecer: usar o que já é fiável (hora de cada confirmação, instruções de equipa em
  passos ±1 a partir da tática inicial, instruções individuais, substituições) e marcar "confirmação sem outro evento"
  como alteração de mentalidade.

### Sessões 12–14 — 2026-11-06, `PerformChannelActions`

- 12 e 13: `PerformChannelActions` não foi intercetado — primeiro porque a procura só via métodos públicos, depois
  porque o método é de `FM.GamePlugin.GamePlugin` (não de `GameInteropSubsystem`). Corrigido; a escuta passou a dizer
  "Método não encontrado" em vez de falhar em silêncio.
- 14 (`tactic-events-20261106-230156.log`): intercetado, 803 lotes. É o protocolo genérico de ligação de dados de toda
  a interface (`AddNode`, `SetPropertyID`, `SetTarget`, `SetData`, `UpdateChannelData`, `ReleaseData`, …).
  - Chave `2994855520794946279` com `UpdateChannelData` a cada segundo = relógio (ruído).
  - Perto de cada mudança de mentalidade há um lote grande (197 / 218 ações) com **um `UpdateChannelData` numa chave
    que não volta a aparecer** (23:03:17.940 → `5535903866046861747`; 23:03:26.430 → `16039631926377000129`).
    Candidatos à escrita da mentalidade.
  - Os valores escritos estão nos "pedidos" (`ValueTuple<int, TypedValue, InteropReference, List<ChannelData>>`) e não
    ficaram no log; só eram mostradas 12 ações por lote.
- Sessão 15: pedidos descritos campo a campo (índice → ação, valor, registo, `ChannelData.property@key`), todas as
  ações `UpdateChannelData`/`SetPropertyID` de cada lote, relógio filtrado.

### Sessão 16 — 2026-11-06, varrimento da mentalidade (sonda v3 + escuta), `tactic-probe/-events-20261106-231514.log`

- A mentalidade escolhida na barra do jogo **não gera `ConfirmTacticalChanges`**. Mas passa sempre no canal como
  texto: nomes reais em PT = **Muito Defensiva, Defender, Cautelosa, Equilibrada, Positiva, Atacar, Muito Atacante**
  (enum 1–7; a lista do menu vem acompanhada de 1…7). Com estes nomes a escuta detetou automaticamente 11 mudanças
  com o minuto de jogo: MD 02:51 → Defender 07:55 → Equilibrada 14:19 → Positiva 19:42 → Atacar 24:02 →
  Muito Atacante 30:18 → Atacar 36:53 → Equilibrada 39:33 → Cautelosa 41:25 → Defender 44:43 → MD 45:56.
- Critério estrito (mesmo valor no mesmo nível, ordem estrita em todos os passos): **0 campos**.
- Critério relaxado (|Spearman| ≥ 0,9): 61 campos, quase todos nos **objetos por jogador apontados por
  `Team+0x1000…0x1260`** (e listas `Team+0x1330`). Ex.: `Team+0x1208→ +0x58` (int32) = 8734, 9200, 9200, 9200, 9400,
  9400, 9400, 9200, 9200, 8734, 8014 — sobe com a mentalidade e desce simetricamente, mas **em patamares**.
- As mudanças nesses objetos aparecem às vezes 2–7 s depois da escolha (Defender, Atacar) e outras vezes só mais
  tarde (provavelmente na paragem seguinte): o motor aplica a tática com atraso. Além disso, os ponteiros
  `Team+0x1000…` mudam de alvo (objetos realocados), o que mistura valores de objetos diferentes na análise.
- Conclusão: a cópia do motor parece estar nesses **objetos por jogador** (parâmetros derivados), não num campo
  "mentalidade". Próximo passo: sonda dedicada que, quando cada ponteiro `Team+0x1000…0x1260` muda ou o objeto é
  reescrito, grava o objeto inteiro com o tick, para mapear a estrutura e o momento exato de aplicação.

### Sessão 17 — 2026-11-06, objetos por jogador (`TacticObjects`), `tactic-objects/-events-20261106-232954.log`

- As 13 escolhas de mentalidade foram detetadas automaticamente pela escuta (03:05 → 38:57).
- 167 ponteiros seguidos em `Team+0xF00…0x1600` (casa e fora), 1747 realocações, 7054 mudanças.
- Critério estrito por passo: 0 campos. Critério independente do tempo (sequência sobe até um pico e desce
  simetricamente): **0 campos na casa e 0 na fora**.
- O candidato da sessão 16 (`+0x1208→ +0x58`) toma valores de um conjunto fixo (3800…9750) que mudam várias vezes por
  segundo — **igual na equipa da IA**, que não mudou a tática. É estado do jogo; a correlação da sessão 16 foi acaso.
- Conclusão: a tática aplicada pelo motor **não está** nos objetos apontados pela equipa. Somando as sessões 1–3
  (equipa, jogadores, listas), 4 (assinatura de IDs), 5–8 (comparação em pausa: só cópias da interface) e 16–17, a
  cópia do motor não foi encontrada nas zonas acessíveis a partir do jogo/equipa/jogadores.
- Confirmado pelo utilizador: o motor só aplica uma mudança tática na paragem de jogo seguinte.

### Versão definitiva — 2026-11-06, `Memory/TacticChangeTracker.cs`

- Abordagem do canal interface → jogo, fora do modo de investigação (opção `Tactics.TrackChanges`, ligada por omissão).
- Regras finais da mentalidade (ver CLAUDE.md, "Alterações táticas"). Repetindo os logs das sessões 11, 15, 16 e 17 no
  rastreador: sessão 15 — Positiva (inicial) → Muito Defensiva (barra) → Positiva (ecrã de táticas, detetada no
  redesenho após Confirmar), ritmo −3/+3, instruções individuais −1/+1, substituição; sessões 16/17 — 11/11 e 13/13
  mudanças com o minuto certo, sem falsos positivos; sessão 11 (sem canal) — as 2 mudanças de mentalidade no ecrã de
  táticas ficam como "confirmado sem conteúdo identificado".
- Paragens (para o minuto de aplicação): bola > 30 cm além de uma linha ou parada ≥ 8 ticks. Em 2 jogos de `samples/`:
  ~120 paragens por jogo.

