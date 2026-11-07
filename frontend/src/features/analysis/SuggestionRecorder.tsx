import { useEffect, useState } from "react"
import type { MatchSnapshot } from "@/types/match"
import { archivedTacticChanges, fetchLiveTacticChanges, type TacticChange } from "@/features/analysis/tacticChangeRecords"
import { loadTacticProfile } from "@/features/analysis/tacticProfile"
import { normalizeTacticChanges } from "@/features/analysis/uiTactic"
import { effectiveProfileAt, recordSuggestions, suggestionsFor } from "@/features/analysis/suggestions"

/**
 * Keeps the log of what the panel would suggest while the analysis drawer is closed (the drawer logs it
 * itself when open), so a tactic change can always be told apart as "suggested" or "your own idea".
 * Renders nothing; mounted by App only for a live match.
 */
export function SuggestionRecorder({ match, apiBase }: { match: MatchSnapshot; apiBase: string }) {
  const [changes, setChanges] = useState<{ matchId?: string | null; changes: TacticChange[] }>()
  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      fetchLiveTacticChanges(apiBase, controller.signal)
        .then(setChanges)
        .catch(() => undefined) // plugin without /api/match/tactics, or closed
    void load()
    const timer = window.setInterval(load, 15_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [apiBase])

  const minute = match.clock.minute
  useEffect(() => {
    if (!match.matchId || archivedTacticChanges(match.matchId) || minute < 1) return
    const raw = changes?.matchId === match.matchId ? changes.changes : []
    const profile = effectiveProfileAt(loadTacticProfile(), normalizeTacticChanges(raw), raw, match)
    recordSuggestions(match.matchId, minute, suggestionsFor(match, profile))
    // Once per game minute; the snapshot of that moment is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.matchId, minute])
  return null
}
