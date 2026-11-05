import { parseLocalArchive } from "@/api/localArchive"
import { preprocessReplayArchive } from "@/api/replay/replayPreprocessor"
import { ReplaySession } from "@/api/replay/replaySession"
import {
  analyseMatch,
  type Insight,
  type InsightTone,
  type MatchAnalysis,
} from "@/features/analysis/engine"
import type { TacticProfile } from "@/features/analysis/tacticProfile"

export type AnalysedMatch = {
  key: string
  fileName: string
  date?: string
  analysis: MatchAnalysis
}

/** Plays an archive to its last frame and analyses the final state. */
export async function analyseArchiveFile(
  file: File,
  profile: TacticProfile
): Promise<AnalysedMatch> {
  const parsed = await parseLocalArchive(await file.arrayBuffer(), file.name)
  const archive = await preprocessReplayArchive({
    summary: parsed.archive,
    metadata: parsed.metadata,
    metadataTimeline: parsed.metadataTimeline,
    frames: parsed.frames,
    ratingConfiguration: parsed.ratingConfiguration,
  })
  if (archive.frameCount === 0) throw new Error("Arquivo sem frames")
  const session = new ReplaySession(archive, { allowLocalAssets: false })
  try {
    const snapshot = session.advanceTo(archive.frameCount - 1)
    return {
      key: parsed.archive.matchId || file.name,
      fileName: file.name,
      date: parsed.archive.matchDate,
      analysis: analyseMatch(snapshot, profile),
    }
  } finally {
    session.dispose()
  }
}

export type RecurringInsight = {
  id: string
  tone: InsightTone
  title: string
  count: number
  share: number
  matches: string[]
  example: Insight
}

export type PlayerAggregate = {
  id: number
  name: string
  appearances: number
  minutes: number
  averageRating?: number
  roles: string[]
  recurringNotes: Array<{ text: string; tone: InsightTone; count: number }>
}

export type SeasonAggregate = {
  matches: number
  record: { wins: number; draws: number; losses: number }
  goalsFor: number
  goalsAgainst: number
  xgFor: number
  xgAgainst: number
  possession?: number
  passAccuracy: number
  crossAccuracy?: number
  offsidesPerMatch: number
  aerialWinRate?: number
  highRegainsPerMatch: number
  counterPressRate?: number
  transitionXgAgainstPerMatch: number
  attackLaneShare: { left: number; centre: number; right: number }
  opponentAttackLaneShare: { left: number; centre: number; right: number }
  scores: { attack: number; defence: number; pressing: number; transition: number }
  recurring: RecurringInsight[]
  players: PlayerAggregate[]
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

export function aggregateMatches(matches: AnalysedMatch[]): SeasonAggregate | undefined {
  if (!matches.length) return undefined
  const analyses = matches.map((match) => match.analysis)
  const sum = (pick: (analysis: MatchAnalysis) => number) =>
    analyses.reduce((total, analysis) => total + pick(analysis), 0)

  const record = { wins: 0, draws: 0, losses: 0 }
  for (const analysis of analyses) {
    if (analysis.goalsFor > analysis.goalsAgainst) record.wins += 1
    else if (analysis.goalsFor === analysis.goalsAgainst) record.draws += 1
    else record.losses += 1
  }

  const crossesAttempted = sum((analysis) => analysis.metrics.crossesAttempted)
  const aerials = sum((analysis) => analysis.metrics.aerialsWon + analysis.metrics.aerialsLost)
  const counterOpportunities = sum((analysis) => analysis.metrics.counterPressOpportunities)
  const possessions = analyses
    .map((analysis) => analysis.metrics.possessionShare)
    .filter((value): value is number => value != null)
  const passesAttempted = sum((analysis) => analysis.metrics.passesAttempted)

  const recurringMap = new Map<string, RecurringInsight>()
  analyses.forEach((analysis, index) => {
    const label = matchLabel(matches[index])
    for (const insight of analysis.insights) {
      // Player-specific problems are aggregated in the player table instead.
      if (insight.area === "players" || insight.area === "gameState") continue
      const entry = recurringMap.get(insight.id)
      if (entry) {
        entry.count += 1
        entry.matches.push(label)
      } else {
        recurringMap.set(insight.id, {
          id: insight.id,
          tone: insight.tone,
          title: insight.title,
          count: 1,
          share: 0,
          matches: [label],
          example: insight,
        })
      }
    }
  })
  const recurring = [...recurringMap.values()]
    .map((entry) => ({ ...entry, share: entry.count / analyses.length }))
    .sort((a, b) => b.count - a.count || toneRank(a.tone) - toneRank(b.tone))

  const playerMap = new Map<number, PlayerAggregate & { ratings: number[]; notes: Map<string, { text: string; tone: InsightTone; count: number }> }>()
  for (const analysis of analyses) {
    for (const report of analysis.players) {
      let entry = playerMap.get(report.id)
      if (!entry) {
        entry = {
          id: report.id,
          name: report.name,
          appearances: 0,
          minutes: 0,
          roles: [],
          recurringNotes: [],
          ratings: [],
          notes: new Map(),
        }
        playerMap.set(report.id, entry)
      }
      entry.appearances += 1
      entry.minutes += report.minutes
      if (report.rating != null && report.minutes >= 20) entry.ratings.push(report.rating)
      if (report.roleIn && !entry.roles.includes(report.roleIn)) entry.roles.push(report.roleIn)
      for (const note of report.notes) {
        if (note.tone === "info" && note.text.startsWith("Alternativa")) continue
        // Notes containing match numbers differ per game; group them by their first clause.
        const key = note.text.replace(/\d+([,.]\d+)?/g, "#").split(":")[0]
        const existing = entry.notes.get(key)
        if (existing) existing.count += 1
        else entry.notes.set(key, { text: note.text, tone: note.tone, count: 1 })
      }
    }
  }
  const players = [...playerMap.values()]
    .map(({ ratings, notes, ...entry }) => ({
      ...entry,
      averageRating: ratings.length ? mean(ratings) : undefined,
      recurringNotes: [...notes.values()]
        .filter((note) => note.count >= Math.min(2, analyses.length))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.minutes - a.minutes)

  const laneMean = (pick: (analysis: MatchAnalysis) => { left: number; centre: number; right: number }) => ({
    left: mean(analyses.map((analysis) => pick(analysis).left)),
    centre: mean(analyses.map((analysis) => pick(analysis).centre)),
    right: mean(analyses.map((analysis) => pick(analysis).right)),
  })

  return {
    matches: analyses.length,
    record,
    goalsFor: sum((analysis) => analysis.goalsFor),
    goalsAgainst: sum((analysis) => analysis.goalsAgainst),
    xgFor: sum((analysis) => analysis.metrics.xg),
    xgAgainst: sum((analysis) => analysis.opponent.xg),
    possession: possessions.length ? mean(possessions) : undefined,
    passAccuracy: passesAttempted ? sum((analysis) => analysis.metrics.passesCompleted) / passesAttempted : 0,
    crossAccuracy: crossesAttempted ? sum((analysis) => analysis.metrics.crossesCompleted) / crossesAttempted : undefined,
    offsidesPerMatch: sum((analysis) => analysis.metrics.offsides) / analyses.length,
    aerialWinRate: aerials ? sum((analysis) => analysis.metrics.aerialsWon) / aerials : undefined,
    highRegainsPerMatch: sum((analysis) => analysis.metrics.highRegains) / analyses.length,
    counterPressRate: counterOpportunities
      ? sum((analysis) => analysis.metrics.counterPressRecoveries) / counterOpportunities
      : undefined,
    transitionXgAgainstPerMatch: sum((analysis) => analysis.opponent.transitionXg) / analyses.length,
    attackLaneShare: laneMean((analysis) => analysis.metrics.attackLaneShare),
    opponentAttackLaneShare: laneMean((analysis) => analysis.opponent.attackLaneShare),
    scores: {
      attack: Math.round(mean(analyses.map((analysis) => analysis.scores.attack))),
      defence: Math.round(mean(analyses.map((analysis) => analysis.scores.defence))),
      pressing: Math.round(mean(analyses.map((analysis) => analysis.scores.pressing))),
      transition: Math.round(mean(analyses.map((analysis) => analysis.scores.transition))),
    },
    recurring,
    players,
  }
}

export function matchLabel(match: AnalysedMatch) {
  const analysis = match.analysis
  return `${analysis.teamName} ${analysis.goalsFor}-${analysis.goalsAgainst} ${analysis.opponentName}`
}

function toneRank(tone: InsightTone) {
  return { problem: 0, warning: 1, info: 2, good: 3 }[tone]
}
