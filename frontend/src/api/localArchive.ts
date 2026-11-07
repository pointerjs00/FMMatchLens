import type { RealtimeFrame, RealtimeMatchMetadata } from "@/api/realtimeMatch"
import { parseArchiveFile } from "@/api/archiveParser"
import type { RatingWeightConfiguration } from "@/lib/ratingCalculator"
import type { TacticChange } from "@/features/analysis/tacticChangeRecords"

export type LocalArchiveSummary = {
  matchId: string
  fileName: string
  startedUnixMilliseconds: number
  endedUnixMilliseconds?: number
  ended: boolean
  frameCount: number
  firstTick: number
  lastTick: number
  matchDate?: string
  homeGoals: number
  awayGoals: number
  fileSizeBytes: number
}

export type ParsedLocalArchive = {
  archive: LocalArchiveSummary
  metadata?: RealtimeMatchMetadata
  metadataTimeline: RealtimeMatchMetadata[]
  frames: RealtimeFrame[]
  ratingConfiguration?: RatingWeightConfiguration
  /** Fork: tactic changes recorded by the plugin (absent in older archives). */
  tacticChanges?: TacticChange[]
}

export function parseLocalArchive(buffer: ArrayBuffer, fileName: string): Promise<ParsedLocalArchive> {
  return parseArchiveFile(buffer, fileName)
}
