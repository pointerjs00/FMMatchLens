/**
 * The game UI draws every instruction as its option text plus an icon id, and the plugin records those
 * pairs raw (`uiValues` changes): e.g. "Mais rápido" / `in-possession-tempo-var-higher`. The icon names the
 * instruction (its variant part is not always right: attacking transition shows `var-hold-shape` next to
 * "Contra-ataque"), the text gives the option.
 *
 * This module turns the raw pairs into absolute instruction values: the first time an instruction is drawn
 * it is the starting value, later different text is a change. Seen in FM27 PT logs (Nov 2026): the in-possession
 * team instructions panel and a player's instructions. Out-of-possession icons have not been seen yet;
 * unknown icons are still shown, named after the icon.
 */
import type { MatchPlayer } from "@/types/match"
import type { TacticChange } from "@/features/analysis/tacticChangeRecords"
import {
  teamInstructionDefinitions,
  type PlayerInstructionTag,
  type TacticProfile,
  type TeamInstructionId,
} from "@/features/analysis/tacticProfile"
import { teamInstructionById } from "@/features/analysis/tacticInstructionIds"

export type UiScope = "team" | "player"

export type UiInstruction = {
  /** Icon id without the option part: one key per instruction. */
  key: string
  title: string
  scope: UiScope
  profileId?: TeamInstructionId
}

const teamInstructionIcons: Array<[prefix: string, title: string, profileId?: TeamInstructionId]> = [
  ["in-possession-directness", "Tipo de passe", "passingDirectness"],
  ["in-possession-tempo", "Ritmo", "tempo"],
  ["in-possession-team-width", "Largura ofensiva", "attackingWidth"],
  ["in-possession-overview-attacking-transition", "Transição ofensiva", "attackingTransition"],
  ["in-possession-overview-creative-freedom", "Liberdade criativa", "creativeFreedom"],
  ["in-possession-overview-time-wasting", "Queimar tempo", "timeWasting"],
  ["in-possession-overview-play-for-set-pieces", "Bolas paradas", "setPieces"],
  ["team-instructions-in-possession-final-third-patience", "Paciência", "patience"],
  ["team-instructions-in-possession-final-third-shots-from-distance", "Remates de longe", "shotsFromDistance"],
  ["team-instructions-in-possession-final-third-cross-location", "Tipo de cruzamento", "crossingStyle"],
  ["team-instructions-in-possession-progression-dribbling", "Drible", "dribbling"],
  ["team-instructions-in-possession-progression-supporting-runs", "Corridas de apoio"],
  ["team-instructions-in-possession-progression-progress-through", "Progredir por", "progressThrough"],
  ["team-instructions-in-possession-progression-passing-reception", "Receção do passe", "passReception"],
  ["team-instructions-in-possession-build-up-strategy", "Estratégia de construção", "buildUp"],
  ["team-instructions-in-possession-build-up-goal-kicks", "Pontapés de baliza", "goalKicks"],
  ["team-instructions-in-possession-build-up-gk-distrubition--speed", "Distribuição do GR (velocidade)", "gkDistributionSpeed"],
  ["team-instructions-in-possession-build-up-gk-distrubition--distrubute-to", "Distribuição do GR (alvo)", "gkDistribution"],
  // Out of possession (seen 7 Nov 2026). "defensive-line-secondary" must come before "defensive-line".
  ["team-instructions-out-of-possession-overview-tackling", "Desarme", "tackling"],
  ["team-instructions-out-of-possession-overview-defensive-transition", "Transição defensiva", "defensiveTransition"],
  ["team-instructions-out-of-possession-overview-line-of-engagement", "Bloco / linha de pressão", "lineOfEngagement"],
  ["team-instructions-out-of-possession-overview-trigger-press", "Frequência de pressão", "triggerPress"],
  ["team-instructions-out-of-possession-overview-crossing-engagement", "Oposição aos cruzamentos", "crossEngagement"],
  ["team-instructions-out-of-possession-overview-pressing-trap", "Armadilha de pressão", "pressingTrap"],
  ["team-instructions-out-of-possession-overview-defensive-line-secondary", "Comportamento da linha", "defensiveLineBehaviour"],
  ["team-instructions-out-of-possession-overview-defensive-line", "Linha defensiva", "defensiveLine"],
  ["team-instructions-out-of-possession-overview-prevent-short-gk-distrubution", "Pressionar saída curta do GR", "shortGkDistribution"],
]

const playerInstructionIcons: Array<[prefix: string, title: string]> = [
  ["player-instructions-in-possession-attacking-width", "Largura"],
  ["player-instructions-in-possession-dribbling-direction", "Direção do drible"],
  ["player-instructions-in-possession-dribbling-frequency", "Frequência do drible"],
  ["player-instructions-in-possession-forward-runs", "Corridas para a frente"],
  ["player-instructions-in-possession-freedom-of-movement", "Liberdade de movimentos"],
  ["player-instructions-in-possession-hold-up-ball", "Segurar a bola"],
  ["player-instructions-in-possession-shooting", "Remates"],
  ["pi_in_possession-passing-strategy", "Estratégia de passe"],
  ["pi_in_possession-passing-risk", "Risco no passe"],
  ["pi_in_possession-cross-from", "Cruzar de"],
  ["in-possession-final-third-cross-strat", "Tipo de cruzamento (individual)"],
]

/**
 * Option text as the game shows it (FM27 PT) → option of the "Tática" tab. Every entry was either seen next
 * to the instruction's icon in the game, or checked against the game's own translation tables
 * (data/game_simulation/languages.fmf, portuguese.ltc ↔ english.ltc joined by string id): a text is listed
 * only when all of its English translations name that option (e.g. "Mista" = Mixed, "Iludir a pressão" =
 * Bypass Press). Texts with more than one meaning in the game ("Expressividade", "Mais elevado") are left out.
 */
const gameOptionLabels: Partial<Record<TeamInstructionId, Record<string, string>>> = {
  tempo: {
    "Muito mais lento": "muchLower",
    "Mais lento": "lower",
    Normal: "balanced",
    "Mais rápido": "higher",
    "Muito mais elevado": "muchHigher",
  },
  attackingWidth: {
    "Mais Compacto": "muchNarrower",
    Compacto: "narrower",
    Normal: "balanced",
    Largura: "wider",
    "Maior Largura": "muchWider",
  },
  tackling: { "Evitar Carrinhos": "stayOnFeet", Normal: "standard", "Desarme Agressivo": "getStuckIn" },
  defensiveTransition: { "Contra-Pressão": "counterPress", Reagrupar: "regroup" },
  lineOfEngagement: { "Pressão alta": "highPress", "Bloco médio": "midBlock", "Bloco baixo": "lowBlock" },
  triggerPress: { "Com mais frequência": "moreOften", "Com menos frequência": "lessOften" },
  defensiveLine: {
    "Muito mais recuada": "muchLower",
    "Mais recuada": "lower",
    Normal: "balanced",
    "Mais avançada": "higher",
    "Muito mais avançada": "muchHigher",
  },
  shortGkDistribution: { Sim: "yes", Não: "no" },
  passingDirectness: {
    "Muito mais curtos": "muchShorter",
    "Mais curtos": "shorter",
    "Mais directos": "direct",
    "Muito mais directos": "muchDirect",
  },
  attackingTransition: { "Manter Formação": "holdShape", "Contra-ataque": "counter" },
  creativeFreedom: { "Mais disciplinado": "disciplined", Disciplinado: "disciplined", "Mais expressivo": "expressive" },
  dribbling: { Desencorajar: "discourage", Encorajar: "encourage" },
  timeWasting: { "Com menos frequência": "lessOften", "Com mais frequência": "moreOften" },
  buildUp: { "Sair da pressão": "playThroughPress", "Iludir a pressão": "bypassPress" },
  goalKicks: { Curta: "short", Mista: "balanced", Longa: "long" },
  gkDistributionSpeed: { "Diminuir ritmo de jogo": "slow", "Distribuir Rapidamente": "quick" },
  patience: { "Levar a Bola até à Área": "workIntoBox" },
  passReception: { "Passar bola para os pés": "feet", "Passar para o espaço": "space" },
  progressThrough: { Flancos: "flanks" },
  crossingStyle: { "Cruzamentos Rasteiros": "low", "Cruzamentos Tensos": "whipped", "Cruzamentos Largos": "floated" },
  crossEngagement: {
    "Impedir cruzamentos": "stop",
    "Convidar aos cruzamentos": "invite",
    "Convidar à realização de cruzamentos": "invite",
  },
}

const neutralLabels = new Set(["equilibrado", "equilibrada", "normal", "padrão"])

/**
 * The game's internal option names (feedback card of a detail menu) → option text in PT, where seen.
 * Used when a pick in a detail menu is not followed by a redraw with the text.
 */
const optionKeyLabels: Record<string, string> = {
  "Attacking Width Very Narrow": "Mais Compacto",
  "Attacking Width Wide": "Largura",
  "Backline Depth Higher": "Mais avançada",
  "Backline Depth High": "Muito mais avançada",
}

/** Last resort name for an icon-only value: its variant part ("much-higher" → "much higher"). */
function optionFromIcon(icon: string) {
  const variant = icon.split(/-var-|-variation-|-type-|-Property-/)[1]
  return variant ? variant.replace(/[-_]+/g, " ").trim() : icon
}

export function uiInstructionOf(icon: string): UiInstruction {
  for (const [prefix, title, profileId] of teamInstructionIcons) {
    if (icon.startsWith(prefix)) return { key: prefix, title, scope: "team", profileId }
  }
  for (const [prefix, title] of playerInstructionIcons) {
    if (icon.startsWith(prefix)) return { key: prefix, title, scope: "player" }
  }
  // Unknown (e.g. out-of-possession): name it after the icon, without the option part.
  const key = icon.split(/-var-|-variation-|-type-|-Property-/)[0]
  const scope: UiScope = icon.includes("player-instructions") || icon.startsWith("pi_") ? "player" : "team"
  const words = key
    .replace(/^(team-instructions-|player-instructions-)/, "")
    .replace(/^(in-possession|out-of-possession|pi_in_possession|pi_out_of_possession)-/, "")
    .replace(/[-_]+/g, " ")
  return { key, title: words.charAt(0).toUpperCase() + words.slice(1), scope }
}

/** Option value of the "Tática" tab for a game option text, when known. */
export function profileOptionFor(id: TeamInstructionId, label: string): string | undefined {
  const known = gameOptionLabels[id]?.[label]
  if (known) return known
  const options = teamInstructionDefinitions.find((item) => item.id === id)?.options ?? []
  const lower = label.toLocaleLowerCase("pt-PT")
  const byLabel = options.find((option) => option.label.toLocaleLowerCase("pt-PT") === lower)
  if (byLabel) return byLabel.value
  if (neutralLabels.has(lower) && options.some((option) => option.value === "balanced")) return "balanced"
  return undefined
}

const mergeWindowMilliseconds = 8_000

/**
 * Replaces raw `uiValues` records by absolute team instruction values (`source: "ui"`): the first value
 * drawn for an instruction is marked `initial`, later different text is a change (quick-change clicks a
 * few seconds apart merge into one). Step records and unidentified confirmations explained by a UI change
 * are dropped; individual instruction steps get the instruction text of the player panel redraw.
 */
export function normalizeTacticChanges(all: readonly TacticChange[]): TacticChange[] {
  const raw = all.filter((change) => !change.cancelled)
  // A pick in a detail menu redraws only the icon: name it after the text the same icon had elsewhere.
  const iconLabels = new Map<string, string>()
  for (const change of raw) {
    for (const pair of change.uiValues ?? []) if (pair.label) iconLabels.set(pair.icon, pair.label)
  }
  const out: TacticChange[] = []
  const state = new Map<string, string>()
  const stateIcons = new Map<string, string>()
  const stateNamed = new Map<string, boolean>()
  const unnamedChanges = new Map<string, TacticChange>()
  const lastChangeAt = new Map<string, number>()
  const playerValues = new Map<string, string>()
  const lastSeenDisplayTick = new Map<string, number>()
  // Changes seen in a one-value redraw (a click); only those merge with the next clicks.
  const clicks = new Set<TacticChange>()
  for (const change of raw) {
    if (change.kind !== "uiValues") {
      out.push(change)
      continue
    }
    const pairs = change.uiValues ?? []
    // A single player instruction drawn on its own is the redraw after a click on it.
    const playerClick = pairs.length === 1 && uiInstructionOf(pairs[0].icon).scope === "player"
    for (const drawn of pairs) {
      const resolved =
        drawn.label || iconLabels.get(drawn.icon) || (drawn.optionKey ? optionKeyLabels[drawn.optionKey] : "") || ""
      const pair = { ...drawn, label: resolved || drawn.optionKey || optionFromIcon(drawn.icon) }
      const instruction = uiInstructionOf(pair.icon)
      if (instruction.scope === "player") {
        const playerKey = `${change.playerName ?? ""}|${instruction.key}`
        const previous = playerValues.get(playerKey)
        playerValues.set(playerKey, pair.label)
        if (playerClick && previous !== pair.label) {
          out.push({
            ...change,
            kind: "playerInstruction",
            source: "ui",
            uiKey: instruction.key,
            uiTitle: instruction.title,
            fromLabel: previous ?? null,
            toLabel: pair.label,
            uiValues: undefined,
          })
        }
        continue
      }

      const previous = state.get(instruction.key)
      const previousIcon = stateIcons.get(instruction.key)
      const previousNamed = stateNamed.get(instruction.key) ?? true
      const seenBefore = lastSeenDisplayTick.get(instruction.key)
      // A value known only by its icon is the same option when the icon is the same.
      const unnamed = !resolved || !previousNamed
      if (previous != null && (previous === pair.label || (unnamed && previousIcon === pair.icon))) {
        if (resolved) {
          state.set(instruction.key, pair.label)
          stateNamed.set(instruction.key, true)
          // The text arrived later: name the change made with only the icon.
          const unnamedChange = unnamedChanges.get(instruction.key)
          if (unnamedChange && !previousNamed) {
            const at = out.indexOf(unnamedChange)
            if (at >= 0) out[at] = { ...unnamedChange, toLabel: pair.label }
          }
          unnamedChanges.delete(instruction.key)
        }
        stateIcons.set(instruction.key, pair.icon)
        lastSeenDisplayTick.set(instruction.key, change.displayTick)
        continue
      }
      state.set(instruction.key, pair.label)
      stateNamed.set(instruction.key, !!resolved)
      stateIcons.set(instruction.key, pair.icon)
      lastSeenDisplayTick.set(instruction.key, change.displayTick)
      const click = pairs.length === 1
      const base = {
        ...change,
        kind: "teamInstruction" as const,
        source: "ui" as const,
        uiKey: instruction.key,
        uiTitle: instruction.title,
        profileInstruction: instruction.profileId ?? null,
        toLabel: pair.label,
        uiValues: undefined,
      }
      if (previous == null) {
        out.push({ ...base, initial: true, fromLabel: null })
        continue
      }
      // Quick-change clicks (Mais rápido → Normal → Mais lento) merge into one change.
      const merged = [...out].reverse().find((item) => item.source === "ui" && item.uiKey === instruction.key && !item.initial)
      if (
        click &&
        merged &&
        clicks.has(merged) &&
        change.capturedUnixMilliseconds - (lastChangeAt.get(instruction.key) ?? 0) <= mergeWindowMilliseconds
      ) {
        out.splice(out.indexOf(merged), 1)
        clicks.delete(merged)
        lastChangeAt.set(instruction.key, change.capturedUnixMilliseconds)
        if (merged.fromLabel !== pair.label) {
          const next = { ...base, sequence: merged.sequence, fromLabel: merged.fromLabel }
          out.push(next)
          clicks.add(next)
        }
        continue
      }
      lastChangeAt.set(instruction.key, change.capturedUnixMilliseconds)
      // Seen only when the whole panel was drawn again (e.g. picked in an instruction's detail menu, which
      // sends nothing): it was made at some point since the instruction was last drawn.
      const next = { ...base, initial: false, fromLabel: previous, uiSinceDisplayTick: click ? undefined : seenBefore }
      out.push(next)
      if (click) clicks.add(next)
      if (!resolved) unnamedChanges.set(instruction.key, next)
    }
  }
  return dropExplained(out).sort((a, b) => a.sequence - b.sequence)
}

function dropExplained(changes: TacticChange[]): TacticChange[] {
  const uiChanges = changes.filter((change) => change.source === "ui" && !change.initial)
  const near = (change: TacticChange, predicate: (other: TacticChange) => boolean) =>
    uiChanges.some(
      (other) => predicate(other) && Math.abs(other.capturedUnixMilliseconds - change.capturedUnixMilliseconds) <= 15_000
    )
  return changes.flatMap((change) => {
    if (change.source === "ui") return [change]
    if (change.kind === "teamInstruction") {
      const id = teamInstructionById[change.instruction ?? -1]
      return id && near(change, (other) => other.profileInstruction === id) ? [] : [change]
    }
    if (change.kind === "playerInstruction") {
      return near(change, (other) => other.kind === "playerInstruction") ? [] : [change]
    }
    if (change.kind === "confirmed") return near(change, () => true) ? [] : [change]
    return [change]
  })
}

// ── Individual instructions read from a player's panel ──────────────────

/**
 * Option text (FM27 PT, lower case) of a player's instruction → tag used by the analysis. Checked against the
 * game's translation tables like gameOptionLabels ("Encurtar Linhas" = Sit Narrower, "Cortar Para Dentro" =
 * Cut Inside With Ball; the game writes "Fazer Mais Arrancadas." with a full stop).
 */
const playerInstructionTags: Array<[iconPrefix: string, label: string, tag: PlayerInstructionTag]> = [
  ["player-instructions-in-possession-dribbling-frequency", "fintar menos", "dribbleLess"],
  ["player-instructions-in-possession-dribbling-frequency", "fintar mais", "dribbleMore"],
  ["player-instructions-in-possession-shooting", "rematar menos", "shootLess"],
  ["player-instructions-in-possession-shooting", "rematar mais", "shootMore"],
  ["player-instructions-in-possession-forward-runs", "fazer mais arrancadas", "moreForwardRuns"],
  ["player-instructions-in-possession-forward-runs", "fazer mais arrancadas.", "moreForwardRuns"],
  ["player-instructions-in-possession-forward-runs", "fazer menos corridas", "fewerForwardRuns"],
  ["pi_in_possession-passing-risk", "correr mais riscos", "moreRisk"],
  ["pi_in_possession-passing-risk", "correr menos riscos", "lessRisk"],
  ["player-instructions-in-possession-attacking-width", "encurtar linhas", "stayNarrower"],
  ["player-instructions-in-possession-dribbling-direction", "cortar para dentro", "cutInside"],
  ["player-instructions-in-possession-hold-up-ball", "sim", "holdUpBall"],
  ["pi_in_possession-passing-strategy", "mais curtos", "shorterPasses"],
  ["in-possession-final-third-cross-strat", "avançado alvo", "crossToTargetForward"],
]

/** The analysis tag of a player's instruction option (`uiKey` of a normalized change and the option text). */
export function playerInstructionTagFor(uiKey: string | undefined, label: string | null | undefined) {
  if (!uiKey || !label) return undefined
  return playerInstructionTags.find(([prefix, text]) => uiKey.startsWith(prefix) && fold(label) === text)?.[2]
}

/** Tags the in-possession panel decides (out-of-possession ones stay as in the "Tática" tab). */
const inPossessionTags = new Set<PlayerInstructionTag>([
  "dribbleMore", "dribbleLess", "shootMore", "shootLess", "moreRisk", "lessRisk", "moreForwardRuns",
  "fewerForwardRuns", "stayNarrower", "stayWider", "cutInside", "holdUpBall", "shorterPasses", "crossToTargetForward",
])

const fold = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-PT").trim()

/** Latest value of each instruction of each player whose panel was drawn (raw changes, before normalizing). */
export function observedPlayerInstructions(raw: readonly TacticChange[]) {
  const byPlayer = new Map<string, Map<string, { icon: string; label: string }>>()
  for (const change of raw) {
    if (change.cancelled || change.kind !== "uiValues" || !change.playerName) continue
    for (const pair of change.uiValues ?? []) {
      if (uiInstructionOf(pair.icon).scope !== "player" || !pair.label) continue
      const values = byPlayer.get(change.playerName) ?? new Map<string, { icon: string; label: string }>()
      values.set(uiInstructionOf(pair.icon).key, { icon: pair.icon, label: pair.label })
      byPlayer.set(change.playerName, values)
    }
  }
  return byPlayer
}

/** The player of our team that a name from the game ("Fredrik Aursnes", "G. Prestianni") refers to. */
export function findPlayerByGameName(name: string, players: readonly MatchPlayer[]) {
  const words = fold(name).split(/\s+/)
  const last = words.at(-1) ?? ""
  const initial = words.length > 1 ? words[0].replace(/\.$/, "") : ""
  const candidates = players.filter((player) =>
    [player.fullName, player.name, player.shirtName].some((text) => {
      if (!text) return false
      const own = fold(text).split(/\s+/)
      return own.at(-1) === last && (!initial || own.length === 1 || own[0].startsWith(initial.charAt(0)))
    })
  )
  return candidates.length === 1 ? candidates[0] : undefined
}

/**
 * Replaces the in-possession individual instructions of the "Tática" tab by the ones read from each player's
 * panel, for the position the player holds now.
 */
export function applyObservedPlayerInstructions(
  profile: TacticProfile,
  observed: ReturnType<typeof observedPlayerInstructions>,
  players: readonly MatchPlayer[]
): TacticProfile {
  if (observed.size === 0) return profile
  const result = { ...profile, players: { ...profile.players } }
  for (const [name, values] of observed) {
    const slot = findPlayerByGameName(name, players)?.inPossession?.position?.toUpperCase()
    if (!slot) continue
    const read = new Set<PlayerInstructionTag>()
    for (const [key, { label }] of values) {
      const tag = playerInstructionTags.find(([prefix, text]) => key.startsWith(prefix) && fold(label) === text)?.[2]
      if (tag) read.add(tag)
    }
    const kept = (result.players[slot] ?? []).filter((tag) => !inPossessionTags.has(tag))
    result.players[slot] = [...read, ...kept]
  }
  return result
}

/** Latest value drawn for each team instruction (for the "Tática" tab). */
export function observedTeamInstructions(changes: readonly TacticChange[]) {
  const latest = new Map<
    string,
    { title: string; label: string; profileId?: TeamInstructionId | null; phase: "Com bola" | "Sem bola" }
  >()
  for (const change of changes) {
    if (change.source !== "ui" || change.kind !== "teamInstruction" || !change.uiKey || !change.toLabel) continue
    latest.set(change.uiKey, {
      title: change.uiTitle ?? change.uiKey,
      label: change.toLabel,
      profileId: change.profileInstruction,
      phase: change.uiKey.includes("out-of-possession") ? "Sem bola" : "Com bola",
    })
  }
  return [...latest.values()]
}

/** Applies an absolute UI value to the tactic, when the option is known. */
export function applyUiValue(profile: TacticProfile, change: TacticChange): TacticProfile {
  const id = change.profileInstruction
  if (!id || !change.toLabel) return profile
  const option = profileOptionFor(id, change.toLabel)
  return option ? { ...profile, team: { ...profile.team, [id]: option } } : profile
}
