/**
 * Team instructions are not captured by the plugin (only formation, roles and
 * duties are). The manager describes them once here; the analysis engine
 * cross-references them with what actually happens on the pitch.
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

export const teamInstructionDefinitions: InstructionDefinition[] = [
  { id: "attackingTransition", label: "Transição ofensiva", phase: "inPossession", defaultValue: "balanced",
    options: [o("holdShape", "Manter posições"), o("balanced", "Equilibrada"), o("counter", "Contra-ataque")] },
  { id: "attackingWidth", label: "Largura ofensiva", phase: "inPossession", defaultValue: "balanced",
    options: [o("muchNarrower", "Muito mais estreita"), o("narrower", "Mais estreita"), o("balanced", "Equilibrada"), o("wider", "Mais larga"), o("muchWider", "Muito mais larga")] },
  { id: "buildUp", label: "Estratégia de construção", phase: "inPossession", defaultValue: "balanced",
    options: [o("playThroughPress", "Jogar através da pressão"), o("balanced", "Equilibrada"), o("bypassPress", "Contornar a pressão")] },
  { id: "creativeFreedom", label: "Liberdade criativa", phase: "inPossession", defaultValue: "balanced",
    options: [o("disciplined", "Mais disciplina"), o("balanced", "Equilibrada"), o("expressive", "Mais expressão")] },
  { id: "crossingStyle", label: "Tipo de cruzamento", phase: "inPossession", defaultValue: "balanced",
    options: [o("low", "Rasteiros"), o("balanced", "Equilibrado"), o("whipped", "Tensos"), o("floated", "Altos")] },
  { id: "dribbling", label: "Drible", phase: "inPossession", defaultValue: "balanced",
    options: [o("discourage", "Desencorajar"), o("balanced", "Equilibrado"), o("encourage", "Encorajar")] },
  { id: "gkDistribution", label: "Distribuição do GR (alvo)", phase: "inPossession", defaultValue: "balanced",
    options: [o("centreBacks", "Centrais"), o("fullBacks", "Laterais"), o("playmaker", "Criativo"), o("balanced", "Equilibrada"), o("targetForward", "Avançado alvo"), o("wingers", "Extremos")] },
  { id: "gkDistributionSpeed", label: "Distribuição do GR (velocidade)", phase: "inPossession", defaultValue: "balanced",
    options: [o("slow", "Lenta"), o("balanced", "Equilibrada"), o("quick", "Rápida")] },
  { id: "goalKicks", label: "Pontapés de baliza", phase: "inPossession", defaultValue: "balanced",
    options: [o("short", "Curtos"), o("balanced", "Equilibrados"), o("long", "Longos")] },
  { id: "overlap", label: "Sobreposição", phase: "inPossession", defaultValue: "none",
    options: [o("none", "Nenhuma"), o("left", "Esquerda"), o("right", "Direita"), o("both", "Ambas")] },
  { id: "underlap", label: "Desdobramento por dentro", phase: "inPossession", defaultValue: "none",
    options: [o("none", "Nenhum"), o("left", "Esquerda"), o("right", "Direita"), o("both", "Ambos")] },
  { id: "passReception", label: "Receção do passe", phase: "inPossession", defaultValue: "balanced",
    options: [o("feet", "No pé"), o("balanced", "Equilibrada"), o("space", "No espaço")] },
  { id: "passingDirectness", label: "Tipo de passe", phase: "inPossession", defaultValue: "balanced",
    options: [o("muchShorter", "Muito mais curto"), o("shorter", "Mais curto"), o("balanced", "Equilibrado"), o("direct", "Mais direto"), o("muchDirect", "Muito mais direto")] },
  { id: "patience", label: "Paciência", phase: "inPossession", defaultValue: "balanced",
    options: [o("workIntoBox", "Trabalhar a bola até à área"), o("balanced", "Equilibrada"), o("earlyCrosses", "Cruzar mais cedo")] },
  { id: "setPieces", label: "Bolas paradas", phase: "inPossession", defaultValue: "balanced",
    options: [o("keepInPlay", "Manter a bola em jogo"), o("balanced", "Equilibrado"), o("playForSetPieces", "Procurar bolas paradas")] },
  { id: "progressThrough", label: "Progredir por", phase: "inPossession", defaultValue: "balanced",
    options: [o("left", "Esquerda"), o("middle", "Meio"), o("right", "Direita"), o("balanced", "Equilibrado"), o("flanks", "Alas")] },
  { id: "shotsFromDistance", label: "Remates de longe", phase: "inPossession", defaultValue: "balanced",
    options: [o("less", "Menos"), o("balanced", "Equilibrado"), o("more", "Mais")] },
  { id: "tempo", label: "Ritmo", phase: "inPossession", defaultValue: "balanced",
    options: [o("muchLower", "Muito mais baixo"), o("lower", "Mais baixo"), o("balanced", "Equilibrado"), o("higher", "Mais alto"), o("muchHigher", "Muito mais alto")] },
  { id: "timeWasting", label: "Queimar tempo", phase: "inPossession", defaultValue: "balanced",
    options: [o("lessOften", "Menos vezes"), o("balanced", "Equilibrado"), o("moreOften", "Mais vezes")] },
  { id: "crossEngagement", label: "Oposição aos cruzamentos", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("stop", "Impedir cruzamentos"), o("balanced", "Equilibrado"), o("invite", "Convidar cruzamentos")] },
  { id: "defensiveLine", label: "Linha defensiva", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("muchLower", "Muito mais baixa"), o("lower", "Mais baixa"), o("balanced", "Equilibrada"), o("higher", "Mais alta"), o("muchHigher", "Muito mais alta")] },
  { id: "defensiveLineBehaviour", label: "Comportamento da linha", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("dropOff", "Recuar"), o("balanced", "Equilibrado"), o("stepUp", "Subir / fora de jogo")] },
  { id: "defensiveTransition", label: "Transição defensiva", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("regroup", "Reagrupar"), o("balanced", "Equilibrada"), o("counterPress", "Contra-pressão")] },
  { id: "lineOfEngagement", label: "Bloco / linha de pressão", phase: "outOfPossession", defaultValue: "midBlock",
    options: [o("lowBlock", "Bloco baixo"), o("midBlock", "Bloco médio"), o("highPress", "Pressão alta")] },
  { id: "pressingTrap", label: "Armadilha de pressão", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("inside", "Forçar para dentro"), o("balanced", "Equilibrada"), o("outside", "Forçar para fora")] },
  { id: "shortGkDistribution", label: "Pressionar saída curta do GR", phase: "outOfPossession", defaultValue: "no",
    options: [o("no", "Não"), o("yes", "Sim")] },
  { id: "tackling", label: "Desarme", phase: "outOfPossession", defaultValue: "standard",
    options: [o("stayOnFeet", "Ficar de pé"), o("standard", "Normal"), o("getStuckIn", "Entrar com força")] },
  { id: "triggerPress", label: "Frequência de pressão", phase: "outOfPossession", defaultValue: "balanced",
    options: [o("lessOften", "Menos vezes"), o("balanced", "Equilibrada"), o("moreOften", "Mais vezes")] },
]

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

export const mentalityLabels: Record<TacticProfile["mentality"], string> = {
  veryDefensive: "Muito defensiva",
  defensive: "Defensiva",
  cautious: "Cautelosa",
  balanced: "Equilibrada",
  positive: "Positiva",
  attacking: "Ofensiva",
  veryAttacking: "Muito ofensiva",
}

/** "teste2" — the tactic used by Benfica (Vertical Tiki-Taka, Balanced). */
export const defaultTacticProfile: TacticProfile = {
  name: "teste2",
  style: "Tiki-Taka Vertical",
  mentality: "balanced",
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
    passReception: "balanced",
    passingDirectness: "shorter",
    patience: "workIntoBox",
    setPieces: "keepInPlay",
    progressThrough: "middle",
    shotsFromDistance: "balanced",
    tempo: "lower",
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
    DL: ["dribbleLess", "moreForwardRuns", "shootLess", "crossToTargetForward", "pressLess"],
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
