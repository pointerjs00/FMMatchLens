import type { ArchivePage, ArchiveSummary } from "@/api/archiveTypes"
import { parseLocalArchive } from "@/api/localArchive"
import type { RealtimeFrame, RealtimeMatchMetadata } from "@/api/realtimeMatch"
import { preprocessReplayArchive } from "@/api/replay/replayPreprocessor"
import { ReplaySession } from "@/api/replay/replaySession"
import { observedRatingWeightConfiguration } from "@/lib/ratingCalculator"
import {
  analyseMatch,
  type Insight,
  type InsightTone,
  type MatchAnalysis,
} from "@/features/analysis/engine"
import type { TacticProfile } from "@/features/analysis/tacticProfile"
import type { TacticChange } from "@/features/analysis/tacticChangeRecords"
import { archiveSuggestionOutcomes, ruleEffects, type RuleEffect, type SuggestionOutcome } from "@/features/analysis/suggestions"

export type AnalysedMatch = {
  key: string
  fileName: string
  date?: string
  analysis: MatchAnalysis
  /** Recorded tactic changes that followed a suggestion of the panel, with their before/after. */
  suggestionOutcomes?: SuggestionOutcome[]
  /** The archive has tactic changes recorded by the plugin. */
  hasTacticChanges?: boolean
}

/** Plays an archive to its last frame and analyses the final state. */
export async function analyseArchiveFile(
  file: File,
  profile: TacticProfile
): Promise<AnalysedMatch> {
  const parsed = await parseLocalArchive(await file.arrayBuffer(), file.name)
  return analysePreparedArchive(
    {
      summary: parsed.archive,
      metadata: parsed.metadata,
      metadataTimeline: parsed.metadataTimeline,
      frames: parsed.frames,
      ratingConfiguration: parsed.ratingConfiguration,
    },
    file.name,
    profile,
    parsed.tacticChanges
  )
}

type ArchiveInput = Parameters<typeof preprocessReplayArchive>[0]

async function analysePreparedArchive(
  input: ArchiveInput,
  fileName: string,
  profile: TacticProfile,
  tacticChanges?: readonly TacticChange[]
): Promise<AnalysedMatch> {
  const archive = await preprocessReplayArchive(input)
  if (archive.frameCount === 0) throw new Error("Arquivo sem frames")
  const session = new ReplaySession(archive, { allowLocalAssets: false })
  try {
    let index = 0
    // First frame at or after a tick (the replay only moves forward).
    const frameAt = (tick: number) => {
      while (index < archive.frameCount - 1 && archive.ticks[index] < tick) index += 1
      return index
    }
    let suggestionOutcomes: SuggestionOutcome[] | undefined
    let snapshot: ReturnType<ReplaySession["advanceTo"]> | undefined
    if (tacticChanges?.length) {
      suggestionOutcomes = archiveSuggestionOutcomes(
        tacticChanges,
        profile,
        (tick) => session.advanceTo(frameAt(tick)),
        () => (snapshot = session.advanceTo(archive.frameCount - 1))
      )
    }
    snapshot ??= session.advanceTo(archive.frameCount - 1)
    return {
      // Same key as a dropped file of the same match, so both sources de-duplicate.
      key: input.summary.matchId || fileName,
      fileName,
      date: input.summary.matchDate,
      analysis: analyseMatch(snapshot, profile),
      suggestionOutcomes,
      hasTacticChanges: (tacticChanges?.length ?? 0) > 0,
    }
  } finally {
    session.dispose()
  }
}

// ── Plugin API (/api/archives) ─────────────────────────────────────────────

/**
 * The plugin clamps `pageSize` to 50. Frames are fetched in pages of 2 400 like
 * the timeline does: one full match is ~23 000 frames and much larger pages
 * produce JSON bodies too big to parse in one string.
 */
const archiveListPageSize = 50
const archiveFramePageSize = 2_400

type ArchiveSlice = {
  archive: ArchiveSummary
  metadata?: RealtimeMatchMetadata
  metadataTimeline?: RealtimeMatchMetadata[]
  frames: readonly RealtimeFrame[]
  tacticChanges?: TacticChange[]
}

/** Every finished archive the plugin has saved; the match still being recorded is skipped. */
export async function listServerArchives(apiBase: string, signal?: AbortSignal) {
  const archives: ArchiveSummary[] = []
  for (let page = 0; ; page += 1) {
    const response = await fetch(
      `${apiBase}/api/archives?page=${page}&pageSize=${archiveListPageSize}`,
      { signal }
    )
    if (!response.ok) throw new Error(`O plugin respondeu ${response.status} à lista de jogos`)
    const result = (await response.json()) as ArchivePage
    archives.push(...result.items)
    // The server clamps an out-of-range page to the last one; stop there.
    if (result.page >= result.pageCount - 1 || result.items.length === 0) break
  }
  return archives.filter((archive) => archive.ended)
}

export async function analyseServerArchive(
  apiBase: string,
  summary: ArchiveSummary,
  profile: TacticProfile,
  signal?: AbortSignal
): Promise<AnalysedMatch> {
  const frames: RealtimeFrame[] = []
  let metadata: RealtimeMatchMetadata | undefined
  let metadataTimeline: RealtimeMatchMetadata[] = []
  let latest: ArchiveSummary | undefined
  let tacticChanges: TacticChange[] | undefined
  let fromTick = 0
  for (;;) {
    const response = await fetch(
      `${apiBase}/api/archives/${encodeURIComponent(summary.matchId)}/frames?fromTick=${fromTick}&stride=1&limit=${archiveFramePageSize}`,
      { signal }
    )
    if (!response.ok) throw new Error(`O plugin respondeu ${response.status}`)
    const page = (await response.json()) as ArchiveSlice
    latest = page.archive
    metadata ??= page.metadata
    if (!metadataTimeline.length && page.metadataTimeline?.length) metadataTimeline = page.metadataTimeline
    if (!tacticChanges?.length && page.tacticChanges?.length) tacticChanges = page.tacticChanges
    if (page.frames.length === 0) break
    frames.push(...page.frames)
    const lastTick = page.frames.at(-1)?.tick ?? fromTick
    if (lastTick >= page.archive.lastTick || page.frames.length < archiveFramePageSize) break
    fromTick = lastTick + 1
  }
  const archive = latest ?? summary
  const fileName = archive.fileName ?? `${archive.matchId}.fmlens`
  return analysePreparedArchive(
    {
      summary: { ...archive, fileName },
      metadata,
      metadataTimeline,
      frames,
      ratingConfiguration: observedRatingWeightConfiguration,
    },
    fileName,
    profile,
    tacticChanges
  )
}

export function serverArchiveLabel(archive: ArchiveSummary) {
  return archive.homeName && archive.awayName
    ? `${archive.homeName} ${archive.homeGoals}-${archive.awayGoals} ${archive.awayName}`
    : (archive.fileName ?? archive.matchId)
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
  /** Matches with tactic changes recorded by the plugin. */
  matchesWithChanges: number
  /** Suggestions of the panel that were followed, by rule, with the average effect. */
  suggestionEffects: RuleEffect[]
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
    matchesWithChanges: matches.filter((match) => match.hasTacticChanges).length,
    suggestionEffects: ruleEffects(matches.flatMap((match) => match.suggestionOutcomes ?? [])),
  }
}

export function matchLabel(match: AnalysedMatch) {
  const analysis = match.analysis
  return `${analysis.teamName} ${analysis.goalsFor}-${analysis.goalsAgainst} ${analysis.opponentName}`
}

function toneRank(tone: InsightTone) {
  return { problem: 0, warning: 1, info: 2, good: 3 }[tone]
}
