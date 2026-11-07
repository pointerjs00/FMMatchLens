import type { MatchPlayer, PlayerPosition } from "@/types/match"
import { decodePlayerTraits, type PlayerTraitKey } from "@/lib/playerTraits"

/** FM stores attributes on a 1–100 scale; the game shows round(value / 5). */
export function attribute(player: MatchPlayer, name: string): number | undefined {
  const attributes = player.attributes
  if (!attributes) return undefined
  const raw =
    attributes.technical[name] ??
    attributes.mental[name] ??
    attributes.physical[name] ??
    attributes.goalkeeping[name]
  if (raw == null || !Number.isFinite(raw)) return undefined
  return Math.min(20, Math.max(1, Math.round(raw / 5)))
}

export function traitsOf(player: MatchPlayer): PlayerTraitKey[] {
  return decodePlayerTraits(player.attributes?.traits)
}

export const attributeLabels: Record<string, string> = {
  Acceleration: "Aceleração",
  Aggression: "Agressividade",
  Agility: "Agilidade",
  Anticipation: "Antecipação",
  Balance: "Equilíbrio",
  Bravery: "Bravura",
  Composure: "Compostura",
  Concentration: "Concentração",
  Crossing: "Cruzamentos",
  Decisions: "Decisões",
  Determination: "Determinação",
  Dribbling: "Drible",
  Finishing: "Finalização",
  "First Touch": "Primeiro toque",
  Flair: "Talento",
  Heading: "Cabeceamento",
  "Jumping Reach": "Impulsão",
  Kicking: "Pontapé",
  Leadership: "Liderança",
  "Long Shots": "Remates de longe",
  Marking: "Marcação",
  "Natural Fitness": "Condição física natural",
  "Off The Ball": "Sem bola",
  Pace: "Velocidade",
  Passing: "Passe",
  Positioning: "Posicionamento",
  Reflexes: "Reflexos",
  Handling: "Manuseamento",
  "One On Ones": "Um para um",
  "Command Of Area": "Domínio da área",
  "Aerial Reach": "Alcance aéreo",
  Stamina: "Resistência",
  Strength: "Força",
  Tackling: "Desarme",
  Teamwork: "Trabalho de equipa",
  Technique: "Técnica",
  Vision: "Visão de jogo",
  "Work Rate": "Índice de trabalho",
}

export const traitLabels: Partial<Record<PlayerTraitKey, string>> = {
  runsWithBallDownLeft: "Conduz a bola pela esquerda",
  runsWithBallDownRight: "Conduz a bola pela direita",
  runsWithBallDownCenter: "Conduz a bola pelo centro",
  getsIntoOppositionArea: "Entra na área adversária",
  movesIntoChannels: "Movimenta-se para os corredores",
  getsForwardWheneverPossible: "Sobe sempre que possível",
  playsShortSimplePasses: "Faz passes curtos e simples",
  triesKillerBallsOften: "Tenta passes de rotura",
  shootsFromDistance: "Remata de longe",
  placesShots: "Coloca os remates",
  marksOpponentTightly: "Marca o adversário de perto",
  playsWithBackToGoal: "Joga de costas para a baliza",
  comesDeepToGetBall: "Recua para pedir a bola",
  dictatesTempo: "Dita o ritmo",
  looksForPassRatherThanAttemptingToScore: "Procura o passe em vez de rematar",
  playsNoThroughBalls: "Não faz passes de rotura",
  dwellsOnBall: "Demora com a bola",
  arrivesLateInOpponentsArea: "Chega tarde à área",
  staysBackAtAllTimes: "Fica sempre atrás",
  divesIntoTackles: "Mergulha nos desarmes",
  doesNotDiveIntoTackles: "Não mergulha nos desarmes",
  cutsInsideFromBothWings: "Flete para dentro dos dois lados",
  hugsLine: "Cola-se à linha",
  triesLongRangePasses: "Tenta passes longos",
  likesBallPlayedIntoFeet: "Gosta da bola no pé",
  likesToBeatManRepeatedly: "Gosta de fintar repetidamente",
  likesToSwitchBallToOtherFlank: "Gosta de variar o flanco",
  runsWithBallOften: "Conduz a bola com frequência",
  runsWithBallRarely: "Raramente conduz a bola",
  refrainsFromTakingLongShots: "Evita remates de longe",
  cutsInsideFromLeftWing: "Flete para dentro pela esquerda",
  cutsInsideFromRightWing: "Flete para dentro pela direita",
  crossesEarly: "Cruza cedo",
  bringsBallOutOfDefense: "Sai a jogar da defesa",
  triesToPlayWayOutOfTrouble: "Tenta sair a jogar de situações apertadas",
  triesTricks: "Tenta truques",
  likesToTryToBreakOffsideTrap: "Tenta furar a linha do fora de jogo",
  shootsWithPower: "Remata com força",
  curlsBall: "Remata em arco",
  likesToRoundKeeper: "Gosta de contornar o GR",
  usesOutsideOfFoot: "Usa a parte de fora do pé",
  windsUpOpponents: "Provoca os adversários",
  arguesWithOfficials: "Discute com o árbitro",
  playsOneTwos: "Faz tabelas",
  likesToLobKeeper: "Gosta de fazer chapéus",
  attemptsOverheadKicks: "Tenta pontapés de bicicleta",
  stopsPlay: "Para o jogo",
  knocksBallPastOpponent: "Toca e passa pelo adversário",
  movesBallToRightFootBeforeDribbleAttempt: "Puxa para o pé direito antes de fintar",
  movesBallToLeftFootBeforeDribbleAttempt: "Puxa para o pé esquerdo antes de fintar",
  avoidsUsingWeakerFoot: "Evita o pé mais fraco",
  triesLongRangeFreeKicks: "Tenta livres de longe",
  getsCrowdGoing: "Puxa pelo público",
  triesFirstTimeShots: "Remata de primeira",
  hitsFreeKickWithPower: "Bate livres com força",
  possessesLongFlatThrow: "Lançamento longo e tenso",
  doesNotMoveIntoChannels: "Não se movimenta para os corredores",
  usesLongThrowToStartCounterAttacks: "Lança contra-ataques com a mão",
  playsBallWithFeet: "Joga com os pés",
}

type RoleProfile = {
  pt: string
  key: string[]
}

/**
 * Key attributes per FM role (in- and out-of-possession role names as the
 * plugin reports them). Kept intentionally short: the attributes that most
 * decide whether a player performs the job, not the full FM highlight list.
 */
const roleProfiles: Record<string, RoleProfile> = {
  "Goalkeeper": { pt: "Guarda-redes", key: ["Reflexes", "Handling", "One On Ones", "Positioning", "Command Of Area", "Concentration"] },
  "Ball-Playing Goalkeeper": { pt: "Guarda-redes com bola", key: ["Passing", "Kicking", "Composure", "First Touch", "Vision", "Reflexes"] },
  "Sweeper Keeper": { pt: "Guarda-redes líbero", key: ["Rushing Out", "One On Ones", "Passing", "Acceleration", "Composure", "Reflexes"] },
  "Line Keeper": { pt: "GR de linha", key: ["Reflexes", "Handling", "One On Ones", "Positioning", "Concentration"] },
  "Wing-Back": { pt: "Ala", key: ["Crossing", "Dribbling", "Stamina", "Work Rate", "Acceleration", "Off The Ball", "Teamwork"] },
  "Pressing Wing-Back": { pt: "Ala pressionante", key: ["Work Rate", "Stamina", "Acceleration", "Tackling", "Aggression", "Teamwork"] },
  "Inverted Wing-Back": { pt: "Ala invertido", key: ["Passing", "First Touch", "Composure", "Decisions", "Vision", "Teamwork"] },
  "Full-Back": { pt: "Lateral", key: ["Marking", "Tackling", "Positioning", "Concentration", "Anticipation", "Acceleration"] },
  "Holding Full-Back": { pt: "Lateral defensivo", key: ["Positioning", "Marking", "Tackling", "Concentration", "Anticipation", "Strength"] },
  "Pressing Full-Back": { pt: "Lateral pressionante", key: ["Work Rate", "Tackling", "Aggression", "Acceleration", "Stamina", "Anticipation"] },
  "Inverted Full-Back": { pt: "Lateral invertido", key: ["Passing", "Composure", "Positioning", "Tackling", "Marking", "Decisions"] },
  "Centre-Back": { pt: "Defesa central", key: ["Marking", "Tackling", "Positioning", "Heading", "Jumping Reach", "Strength", "Concentration"] },
  "Ball-Playing Defender": { pt: "Central de construção", key: ["Passing", "Composure", "Vision", "Marking", "Tackling", "Positioning"] },
  "Wide Centre-Back": { pt: "Central descaído", key: ["Marking", "Tackling", "Positioning", "Dribbling", "Crossing", "Stamina"] },
  "Libero": { pt: "Líbero", key: ["Passing", "Composure", "Vision", "Dribbling", "Positioning", "Decisions"] },
  "Defensive Midfielder": { pt: "Médio defensivo", key: ["Tackling", "Positioning", "Anticipation", "Concentration", "Decisions", "Teamwork", "Work Rate"] },
  "Pressing Defensive Midfielder": { pt: "Médio defensivo pressionante", key: ["Work Rate", "Tackling", "Aggression", "Stamina", "Anticipation", "Teamwork"] },
  "Deep-Lying Playmaker": { pt: "Construtor recuado", key: ["Passing", "Vision", "First Touch", "Composure", "Decisions", "Technique"] },
  "Half Back": { pt: "Pivô defensivo", key: ["Positioning", "Marking", "Tackling", "Passing", "Composure", "Decisions"] },
  "Anchor": { pt: "Âncora", key: ["Positioning", "Concentration", "Marking", "Tackling", "Anticipation", "Decisions"] },
  "Regista": { pt: "Regista", key: ["Passing", "Vision", "Technique", "Flair", "Composure", "Decisions"] },
  "Advanced Playmaker": { pt: "Construtor de jogo avançado", key: ["Passing", "Vision", "First Touch", "Technique", "Decisions", "Composure", "Off The Ball"] },
  "Midfield Playmaker": { pt: "Médio de construção", key: ["Passing", "Vision", "First Touch", "Technique", "Decisions", "Composure", "Teamwork"] },
  "Roaming Playmaker": { pt: "Construtor móvel", key: ["Passing", "Vision", "Stamina", "Work Rate", "First Touch", "Decisions"] },
  "Central Midfielder": { pt: "Médio centro", key: ["Passing", "Decisions", "Teamwork", "Work Rate", "Tackling", "Positioning"] },
  "Pressing Central Midfielder": { pt: "Médio centro pressionante", key: ["Work Rate", "Stamina", "Aggression", "Tackling", "Teamwork", "Anticipation"] },
  "Box-To-Box Midfielder": { pt: "Médio box-to-box", key: ["Stamina", "Work Rate", "Passing", "Tackling", "Off The Ball", "Teamwork"] },
  "Box-to-Box Midfielder": { pt: "Médio box-to-box", key: ["Stamina", "Work Rate", "Passing", "Tackling", "Off The Ball", "Teamwork"] },
  "Ball-Winning Midfielder": { pt: "Médio recuperador", key: ["Tackling", "Aggression", "Work Rate", "Stamina", "Anticipation", "Teamwork"] },
  "Channel Midfielder": { pt: "Médio entrelinhas", key: ["Off The Ball", "Stamina", "Work Rate", "Passing", "Acceleration", "Decisions"] },
  "Mezzala": { pt: "Mezzala", key: ["Off The Ball", "Dribbling", "Passing", "Vision", "Technique", "Decisions"] },
  "Carrilero": { pt: "Carrilero", key: ["Positioning", "Stamina", "Teamwork", "Work Rate", "Passing", "Tackling"] },
  "Wide Midfielder": { pt: "Médio ala", key: ["Work Rate", "Stamina", "Teamwork", "Tackling", "Positioning", "Acceleration"] },
  "Defensive Winger": { pt: "Extremo defensivo", key: ["Work Rate", "Stamina", "Tackling", "Positioning", "Crossing", "Teamwork"] },
  "Winger": { pt: "Extremo", key: ["Crossing", "Dribbling", "Acceleration", "Pace", "Technique", "Agility"] },
  "Inverted Winger": { pt: "Extremo invertido", key: ["Dribbling", "Passing", "Technique", "Vision", "Acceleration", "Agility"] },
  "Inside Forward": { pt: "Avançado interior", key: ["Dribbling", "Finishing", "Acceleration", "Off The Ball", "Technique", "Composure", "First Touch"] },
  "Wide Forward": { pt: "Avançado aberto", key: ["Dribbling", "Finishing", "Acceleration", "Pace", "Off The Ball", "Technique", "First Touch"] },
  "Raumdeuter": { pt: "Raumdeuter", key: ["Off The Ball", "Anticipation", "Finishing", "Composure", "Concentration", "Acceleration"] },
  "Attacking Midfielder": { pt: "Médio ofensivo", key: ["Passing", "Vision", "First Touch", "Technique", "Off The Ball", "Decisions"] },
  "Shadow Striker": { pt: "Segundo avançado", key: ["Off The Ball", "Finishing", "Anticipation", "Composure", "Acceleration", "First Touch"] },
  "Trequartista": { pt: "Trequartista", key: ["Vision", "Technique", "Flair", "First Touch", "Passing", "Composure"] },
  "Enganche": { pt: "Enganche", key: ["Vision", "Passing", "First Touch", "Technique", "Composure", "Decisions"] },
  "Deep-Lying Forward": { pt: "Avançado recuado", key: ["First Touch", "Passing", "Vision", "Strength", "Technique", "Composure", "Decisions"] },
  "Advanced Forward": { pt: "Ponta-de-lança móvel", key: ["Finishing", "Off The Ball", "Acceleration", "Pace", "Composure", "First Touch"] },
  "Poacher": { pt: "Matador", key: ["Finishing", "Off The Ball", "Anticipation", "Composure", "Acceleration"] },
  "Target Forward": { pt: "Avançado alvo", key: ["Heading", "Jumping Reach", "Strength", "First Touch", "Balance", "Bravery"] },
  "Target Man": { pt: "Avançado alvo", key: ["Heading", "Jumping Reach", "Strength", "First Touch", "Balance", "Bravery"] },
  "Channel Forward": { pt: "Avançado entrelinhas", key: ["Off The Ball", "Acceleration", "Pace", "Work Rate", "Finishing", "Stamina"] },
  "False Nine": { pt: "Falso 9", key: ["First Touch", "Passing", "Vision", "Technique", "Off The Ball", "Decisions"] },
  "Complete Forward": { pt: "Avançado completo", key: ["Finishing", "First Touch", "Heading", "Strength", "Technique", "Composure"] },
  "Pressing Forward": { pt: "Avançado pressionante", key: ["Work Rate", "Stamina", "Aggression", "Acceleration", "Anticipation", "Teamwork"] },
  "Tracking Centre-Forward": { pt: "Ponta-de-lança de contenção", key: ["Work Rate", "Stamina", "Aggression", "Acceleration", "Anticipation", "Teamwork"] },
  "Centre-Forward": { pt: "Ponta-de-lança", key: ["Finishing", "Off The Ball", "Composure", "First Touch", "Strength", "Heading"] },
}

/**
 * PT names of FM26/27 roles that have no key-attribute profile above, from the game's own translation tables
 * (portuguese.ltc / english.ltc, scripts/research/fm_translations.py). Where the game has two texts for a
 * role, the one from its role list (ids 269131603–269131641, the same list as "Médio centro pressionante")
 * is used. Roles with no translation found (e.g. Playmaking Wing-Back) stay in English.
 */
const gameRoleNames: Record<string, string> = {
  "Central Defender": "Defesa central",
  "Central-Outlet Attacking Midfielder": "Médio ofensivo central de transição",
  "Central-Outlet Centre-Forward": "Ponta-de-lança de transição",
  "Covering Centre-Back": "Central de cobertura",
  "Dropping Defensive Midfielder": "Médio defensivo recuado",
  "Half-Back": "Pivô defensivo",
  "Holding Wing-Back": "Ala defensivo",
  "No-Nonsense Centre-Back": "Defesa central descomplicado",
  "No-Nonsense Goalkeeper": "Guarda-redes pragmático",
  "Overlapping Centre-Back": "Central de projecção ofensiva",
  "Screening Central Midfielder": "Médio centro de contenção",
  "Screening Defensive Midfielder": "Médio defensivo de contenção",
  "Splitting-Outlet Attacking Midfielder": "Médio ofensivo de distribuição",
  "Splitting-Outlet Centre-Forward": "Ponta-de-lança de distribuição",
  "Stopping Centre-Back": "Central de marcação",
  "Stopping Wide Centre-Back": "Central de marcação descaído",
  "Tracking Attacking Midfielder": "Médio ofensivo de contenção",
  "Tracking Winger": "Extremo de contenção",
  "Wide-Outlet Wide Midfielder": "Médio ala de transição",
}

export function rolePt(role?: string) {
  if (!role) return "—"
  return roleProfiles[role]?.pt ?? gameRoleNames[role] ?? role
}

export type RoleFit = {
  role: string
  rolePt: string
  score: number
  weakest: Array<{ attribute: string; value: number }>
}

export function roleFit(player: MatchPlayer, role?: string): RoleFit | undefined {
  if (!role) return undefined
  const profile = roleProfiles[role]
  if (!profile) return undefined
  const values = profile.key
    .map((name) => ({ attribute: name, value: attribute(player, name) }))
    .filter((item): item is { attribute: string; value: number } => item.value != null)
  if (values.length < 3) return undefined
  const score = values.reduce((sum, item) => sum + item.value, 0) / values.length
  return {
    role,
    rolePt: profile.pt,
    score,
    weakest: [...values].sort((a, b) => a.value - b.value).slice(0, 2),
  }
}

/** Collapses a slot (MCL, DCR, DMC, AMCL…) to FM's base position familiarity key. */
export function basePosition(slot?: string): PlayerPosition | undefined {
  if (!slot) return undefined
  const normalized = slot.toUpperCase()
  if (normalized === "GK") return "GK"
  if (normalized === "SW") return "SW"
  if (normalized.startsWith("WB")) return normalized === "WBL" ? "WBL" : "WBR"
  if (normalized.startsWith("DC")) return "DC"
  if (normalized === "DL" || normalized === "DR") return normalized
  if (normalized.startsWith("DM")) return "DM"
  if (normalized === "ML" || normalized === "MR") return normalized
  if (normalized.startsWith("MC")) return "MC"
  if (normalized === "AML" || normalized === "AMR") return normalized
  if (normalized.startsWith("AMC")) return "AMC"
  if (normalized.startsWith("ST")) return "ST"
  return undefined
}

export const slotLabels: Record<string, string> = {
  GK: "GR",
  DL: "D (E)",
  DR: "D (D)",
  DC: "D (C)",
  DCL: "D (C) esq.",
  DCR: "D (C) dir.",
  DCC: "D (C)",
  WBL: "DA (E)",
  WBR: "DA (D)",
  DM: "MD",
  DMC: "MD",
  DML: "MD esq.",
  DMR: "MD dir.",
  ML: "M (E)",
  MR: "M (D)",
  MC: "M (C)",
  MCL: "M (C) esq.",
  MCR: "M (C) dir.",
  AML: "MO (E)",
  AMR: "MO (D)",
  AMC: "MO (C)",
  AMCL: "MO (C) esq.",
  AMCR: "MO (C) dir.",
  ST: "PL",
  STC: "PL",
  STL: "PL esq.",
  STR: "PL dir.",
}

export function slotLabel(slot?: string) {
  if (!slot) return "—"
  return slotLabels[slot.toUpperCase()] ?? slot
}

export function playerLabel(player: MatchPlayer) {
  return player.name
}
