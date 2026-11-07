/**
 * The starting tactic. The plugin cannot read the tactic itself, only the changes made during a match
 * (mentality, quick changes of team instructions…, see tacticChanges.ts). The manager describes the
 * starting tactic once here; the panel applies the detected changes on top of it.
 */

export type InstructionOption = { value: string; label: string }
export type InstructionDefinition = {
  id: TeamInstructionId
  label: string
  phase: "inPossession" | "outOfPossession"
  options: InstructionOption[]
  /** Option used by FM when the instruction is left untouched. */
  defaultValue: string
}

export type TeamInstructionId =
  | "attackingTransition"
  | "attackingWidth"
  | "buildUp"
  | "creativeFreedom"
  | "crossingStyle"
  | "dribbling"
  | "gkDistribution"
  | "gkDistributionSpeed"
  | "goalKicks"
  | "overlap"
  | "underlap"
  | "passReception"
  | "passingDirectness"
  | "patience"
  | "setPieces"
  | "progressThrough"
  | "shotsFromDistance"
  | "tempo"
  | "timeWasting"
  | "crossEngagement"
  | "defensiveLine"
  | "defensiveLineBehaviour"
  | "defensiveTransition"
  | "lineOfEngagement"
  | "pressingTrap"
  | "shortGkDistribution"
  | "tackling"
  | "triggerPress"

const o = (value: string, label: string): InstructionOption => ({ value, label })

/**
 * Names as the FM27 screen "Instruções à Equipa" writes them (instruction and option). Option texts come from
 * the game: seen on that screen or in the game's translation tables (see uiTactic.ts gameOptionLabels).
 * Options never seen in the game keep a descriptive name.
 */
export const teamInstructionDefinitions: InstructionDefinition[] = [
  { id: "attackingTransition", label: "Transição Ofensiva", phase: "inPossession", defaultValue: "balanced",
    options: [o("holdShape", "Manter Formação"), o("balanced", "Equilibrada"), o("counter", "Contra-ataque")] },
  { id: "attackingWidth", label: "Largura Atacante", phase: "inPossession", defaultValue: "balanced",
    options: [o("muchNarrower", "Mais Compacto"), o("narrower", "Compacto"), o("balanced", "Normal"), o("wider", "Largura"), o("muchWider", "Maior Largura")] },
  { id: "buildUp", label: "Construir Jogo", phase: "inPossession", defaultValue: "balanced",
    options: [o("playThroughPress", "Sair da pressão"), o("balanced", "Equilibrado"), o("bypassPress", "Iludir a pressão")] },
  { id: "creativeFreedom", label: "Liberdade Criativa", phase: "inPossession", defaultValue: "balanced",
    options: [o("disciplined", "Mais disciplinado"), o("balanced", "Equilibrado"), o("expressive", "Mais expressivo")] },
  { id: "crossingStyle", label: "Estilo de cruzamentos", phase: "inPossession", defaultValue: "balanced",
    options: [o("low", "Cruzamentos Rasteiros"), o("balanced", "Equilibrado"), o("whipped", "Cruzamentos Tensos"), o("floated", "Cruzamentos Largos")] },
  { id: "dribbling", label: "Finta", phase: "inPossession", defaultValue: "balanced",
    options: [o("discourage", "Desencorajar"), o("balanced", "Equilibrado"), o("encourage", "Encorajar")] },
  { id: "gkDistribution", label: "Distribuição do GR", phase: "inPossession", defaultValue: "balanced",
    options: [o("centreBacks", "Centrais"), o("fullBacks", "Laterais"), o("playmaker", "Criativo"), o("balanced", "Equilibrada"), o("targetForward", "Avançado alvo"), o("wingers", "Extremos")] },
  { id: "gkDistributionSpeed", label: "Distribuição do GR (velocidade)", phase: "inPossession", defaultValue: "balanced",
    options: [o("slow", "Diminuir ritmo de jogo"), o("balanced", "Equilibrado"), o("quick", "Distribuir Rapidamente")] },
  { id: "goalKicks", label: "Pontapés de Baliza", phase: "inPossession", defaultValue: "balanced",
    options: [o("short", "Curta"), o("balanced", "Mista"), o("long", "Longa")] },
  // FM27: one screen ("Apoiar Corridas com Bola" = Supporting Runs) with both choices; a flank cannot have both.
  { id: "overlap", label: "Sobreposição", phase: "inPossession", defaultValue: "none",
    options: [o("none", "Equilibrado"), o("left", "Esquerdo"), o("right", "Direito"), o("both", "Sobreposição em ambos os flancos")] },
  { id: "underlap", label: "Sobreposição interior", phase: "inPossession", defaultValue: "none",
    options: [o("none", "Equilibrado"), o("left", "Esquerdo"), o("right", "Direito"), o("both", "Sobreposição falsa em ambos os flancos")] },
  { id: "passReception", label: "Recepção do Passe", phase: "inPossession", defaultValue: "balanced",
    options: [o("feet", "Passar bola para os pés"), o("balanced", "Equilibrada"), o("space", "Passar para o espaço")] },
  { id: "passingDirectness", label: "Carácter Directo dos Passes", phase: "inPossession", defaultValue: "balanced",
    options: [o("muchShorter", "Muito mais curtos"), o("shorter", "Mais curtos"), o("balanced", "Equilibrado"), o("direct", "Mais directos"), o("muchDirect", "Muito mais directos")] },
  { id: "patience", label: "Paciência", phase: "inPossession", defaultValue: "balanced",
    options: [o("workIntoBox", "Levar a Bola até à Área"), o("balanced", "Normal"), o("earlyCrosses", "Cruzar mais cedo")] },
  { id: "setPieces", label: "Jogar para as Bolas Paradas", phase: "inPossession", defaultValue: "balanced",
    options: [o("keepInPlay", "Manter a bola em jogo"), o("balanced", "Equilibrado"), o("playForSetPieces", "Procurar bolas paradas")] },
  { id: "progressThrough", label: "Avançar por", phase: "inPossession", defaultValue: "balanced",
    options: [o("left", "Esquerda"), o("middle", "Meio"), o("right", "Direita"), o("balanced", "Equilibrado"), o("flanks", "Flancos")] },
  { id: "shotsFromDistance", label: "Remates de Longe", phase: "inPossession", defaultValue: "balanced",
    options: [o("less", "Menos"), o("balanced", "Equilibrado"), o("more", "Mais")] },
  { id: "tempo", label: "Ritmo", phase: "inPossession", defaultValue: "balanced",
    options: [o("muchLower", "Muito mais lento"), o("lower", "Mais lento"), o("balanced", "Normal"), o("higher", "Mais rápido"), o("muchHigher", "Muito mais elevado")] },
  { id: "timeWasting", label: "Perder Tempo", phase: "inPossession", defaultValue: "balanced",
    options: [o("lessOften", "Com menos frequência"), o("balanced", "Equilibrado"), o("moreOften", "Com mais frequência")] },
  { id: "crossEngagement", label: "Pressão sob Cruzamentos", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("stop", "Impedir cruzamentos"), o("balanced", "Equilibrada"), o("invite", "Convidar aos cruzamentos")] },
  { id: "defensiveLine", label: "Linha Defensiva", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("muchLower", "Muito mais recuada"), o("lower", "Mais recuada"), o("balanced", "Normal"), o("higher", "Mais avançada"), o("muchHigher", "Muito mais avançada")] },
  { id: "defensiveLineBehaviour", label: "Comportamento da linha defensiva", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("dropOff", "Recuar"), o("balanced", "Equilibrado"), o("stepUp", "Subir / fora de jogo")] },
  { id: "defensiveTransition", label: "Transição Defensiva", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("regroup", "Reagrupar"), o("balanced", "Equilibrada"), o("counterPress", "Contra-Pressão")] },
  { id: "lineOfEngagement", label: "Linha de Pressão", phase: "outOfPossession", defaultValue: "midBlock",
    options: [o("lowBlock", "Bloco baixo"), o("midBlock", "Bloco médio"), o("highPress", "Pressão alta")] },
  { id: "pressingTrap", label: "Zona de Pressão", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("inside", "Forçar para dentro"), o("balanced", "Equilibrado"), o("outside", "Forçar para fora")] },
  { id: "shortGkDistribution", label: "Distribuição Curta do Guarda-redes", phase: "outOfPossession", defaultValue: "no",
    options: [o("no", "Não"), o("yes", "Sim")] },
  { id: "tackling", label: "Desarme", phase: "outOfPossession", defaultValue: "standard",
    options: [o("stayOnFeet", "Evitar Carrinhos"), o("standard", "Normal"), o("getStuckIn", "Desarme Agressivo")] },
  { id: "triggerPress", label: "Fazer Pressão", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("lessOften", "Com menos frequência"), o("balanced", "Equilibrada"), o("moreOften", "Com mais frequência")] },
]

/** The tiles of the game's "Instruções à Equipa" screen, in the game's order (FM27, Nov 2026). */
export const gameInstructionScreen: Record<"inPossession" | "outOfPossession", TeamInstructionId[]> = {
  inPossession: [
    "passingDirectness", "tempo", "attackingWidth", "attackingTransition", "creativeFreedom",
    "timeWasting", "setPieces", "patience", "shotsFromDistance", "crossingStyle",
    "dribbling", "underlap", "progressThrough", "passReception", "buildUp",
    "goalKicks", "gkDistributionSpeed", "gkDistribution",
  ],
  outOfPossession: [
    "lineOfEngagement", "defensiveLine", "defensiveLineBehaviour", "triggerPress", "defensiveTransition",
    "tackling", "shortGkDistribution", "pressingTrap", "crossEngagement",
  ],
}

export type TeamInstructions = Record<TeamInstructionId, string>

/**
 * Individual instructions keyed by the FM position slot (e.g. "AML", "MC",
 * "DM"). Values are free tags understood by the player-fit rules.
 */
export type PlayerInstructionTag =
  | "dribbleMore" | "dribbleLess"
  | "shootMore" | "shootLess"
  | "moreRisk" | "lessRisk"
  | "moreForwardRuns" | "fewerForwardRuns"
  | "stayNarrower" | "stayWider"
  | "cutInside"
  | "pressMore" | "pressLess"
  | "markTighter" | "tackleHarder"
  | "holdUpBall" | "shorterPasses"
  | "crossToTargetForward"

export const playerInstructionLabels: Record<PlayerInstructionTag, string> = {
  dribbleMore: "Fintar mais",
  dribbleLess: "Fintar menos",
  shootMore: "Rematar mais",
  shootLess: "Rematar menos",
  moreRisk: "Correr mais riscos no passe",
  lessRisk: "Correr menos riscos no passe",
  moreForwardRuns: "Fazer mais arrancadas",
  fewerForwardRuns: "Fazer menos corridas",
  stayNarrower: "Encurtar linhas (mais por dentro)",
  stayWider: "Abrir mais",
  cutInside: "Cortar para dentro",
  pressMore: "Pressionar com mais frequência",
  pressLess: "Pressionar com menos frequência",
  markTighter: "Marcar mais apertado",
  tackleHarder: "Desarmar com mais força",
  holdUpBall: "Segurar a bola",
  shorterPasses: "Passes mais curtos",
  crossToTargetForward: "Cruzar para o avançado alvo",
}

export type TacticProfile = {
  name: string
  style?: string
  mentality: "veryDefensive" | "defensive" | "cautious" | "balanced" | "positive" | "attacking" | "veryAttacking"
  formationInPossession?: string
  formationOutOfPossession?: string
  team: TeamInstructions
  /** Position slot (GK, DL, DC, DR, DM, MC, AML, AMR, ST...) → tags. */
  players: Record<string, PlayerInstructionTag[]>
}

/** As in FM27 PT (match bar). */
export const mentalityLabels: Record<TacticProfile["mentality"], string> = {
  veryDefensive: "Muito Defensiva",
  defensive: "Defender",
  cautious: "Cautelosa",
  balanced: "Equilibrada",
  positive: "Positiva",
  attacking: "Atacar",
  veryAttacking: "Muito Atacante",
}

/** "teste2" — the tactic used by Benfica (Vertical Tiki-Taka, Positiva; checked in game, Nov 2026). */
export const defaultTacticProfile: TacticProfile = {
  name: "teste2",
  style: "Tiki-Taka Vertical",
  mentality: "positive",
  formationInPossession: "4-1-2-2-1",
  formationOutOfPossession: "4-1-4-1",
  team: {
    attackingTransition: "counter",
    attackingWidth: "muchNarrower",
    buildUp: "playThroughPress",
    creativeFreedom: "balanced",
    crossingStyle: "low",
    dribbling: "encourage",
    gkDistribution: "centreBacks",
    gkDistributionSpeed: "balanced",
    goalKicks: "short",
    overlap: "left",
    underlap: "right",
    passReception: "space",
    passingDirectness: "shorter",
    patience: "workIntoBox",
    setPieces: "keepInPlay",
    progressThrough: "middle",
    shotsFromDistance: "balanced",
    tempo: "higher",
    timeWasting: "lessOften",
    crossEngagement: "balanced",
    defensiveLine: "higher",
    defensiveLineBehaviour: "balanced",
    defensiveTransition: "counterPress",
    lineOfEngagement: "highPress",
    pressingTrap: "balanced",
    shortGkDistribution: "yes",
    tackling: "standard",
    triggerPress: "moreOften",
  },
  players: {
    AML: ["stayNarrower", "cutInside", "dribbleMore", "moreForwardRuns"],
    AMR: ["stayNarrower", "dribbleMore", "moreForwardRuns", "lessRisk", "shorterPasses"],
    MCL: ["fewerForwardRuns", "shootLess", "moreRisk", "pressMore"],
    MCR: ["moreRisk"],
    DM: ["dribbleLess", "fewerForwardRuns", "shootLess", "lessRisk", "shorterPasses", "markTighter", "tackleHarder"],
    DL: ["dribbleLess", "shootLess", "crossToTargetForward", "pressLess"],
    DR: ["dribbleLess", "shootLess", "moreForwardRuns"],
    DC: ["fewerForwardRuns", "moreRisk"],
    ST: ["holdUpBall"],
  },
}

/**
 * Individual instructions for a slot. The exact slot (MCL, DCR, DMC…) wins over
 * its base position (MC, DC, DM…), so two central midfielders can differ.
 */
export function instructionsForSlot(profile: TacticProfile, slot?: string): PlayerInstructionTag[] {
  if (!slot) return []
  const upper = slot.toUpperCase()
  if (profile.players[upper]) return profile.players[upper]
  const base = upper
    .replace(/^DC[LRC]$/, "DC")
    .replace(/^DM[LRC]$/, "DM")
    .replace(/^MC[LRC]$/, "MC")
    .replace(/^AMC[LRC]$/, "AMC")
    .replace(/^ST[LRC]$/, "ST")
  return profile.players[base] ?? []
}

const storageKey = "fmmatchlens.analysis.tacticProfile.v1"

export function loadTacticProfile(): TacticProfile {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return defaultTacticProfile
    const parsed = JSON.parse(raw) as Partial<TacticProfile>
    return {
      ...defaultTacticProfile,
      ...parsed,
      team: { ...defaultTacticProfile.team, ...(parsed.team ?? {}) },
      players: parsed.players ?? defaultTacticProfile.players,
    }
  } catch {
    return defaultTacticProfile
  }
}

export function saveTacticProfile(profile: TacticProfile) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(profile))
  } catch {
    // Storage can be unavailable (private mode); the profile stays in memory.
  }
}

export function instructionLabel(id: TeamInstructionId, value: string) {
  const definition = teamInstructionDefinitions.find((item) => item.id === id)
  return definition?.options.find((option) => option.value === value)?.label ?? value
}
