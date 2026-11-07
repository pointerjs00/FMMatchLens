/**
 * Tactic change records written by the plugin (TacticChangeTracker), kept free of analysis imports so the
 * archive parser can use them without pulling the analysis panel into the main bundle.
 * The analysis lives in tacticChanges.ts.
 */
import type { TeamInstructionId } from "@/features/analysis/tacticProfile"

export type TacticChangeKind = "mentality" | "teamInstruction" | "playerInstruction" | "swap" | "confirmed" | "uiValues"

/** An instruction as drawn by the game UI (see uiTactic.ts). */
export type TacticUiValue = { icon: string; label: string }

export type TacticChange = {
  sequence: number
  kind: TacticChangeKind
  capturedUnixMilliseconds: number
  tick: number
  displayTick: number
  appliedTick?: number | null
  appliedDisplayTick?: number | null
  /** 1 (very defensive) … 7 (very attacking). */
  mentality?: number | null
  mentalityName?: string | null
  previousMentality?: number | null
  /** The mentality the match started with. */
  initial?: boolean
  /** FM's TacticTeamInstructions id (e.g. 21 = tempo). */
  instruction?: number | null
  instructionName?: string | null
  /** Levels moved; positive = towards the end of the option list (e.g. faster tempo). */
  steps?: number | null
  stepCount?: number | null
  /** Raw instructions drawn by the UI (`uiValues` records). */
  uiValues?: TacticUiValue[] | null
  // Filled by normalizeTacticChanges (uiTactic.ts) for changes derived from the UI text:
  source?: "ui"
  uiKey?: string
  uiTitle?: string
  profileInstruction?: TeamInstructionId | null
  fromLabel?: string | null
  toLabel?: string
  /** Seen in a full redraw: made at some point after this display tick (when it was last drawn). */
  uiSinceDisplayTick?: number
}

const tacticChangeFormatVersion = 1

/** Payload of a tactic change archive record: `{"v":1,"change":{…}}` in UTF-8. */
export function decodeTacticChangeRecord(payload: Uint8Array): TacticChange | undefined {
  try {
    const envelope = JSON.parse(new TextDecoder().decode(payload)) as { v?: number; change?: TacticChange }
    if (envelope.v !== tacticChangeFormatVersion || !envelope.change) return undefined
    const change = envelope.change
    return typeof change.sequence === "number" && typeof change.kind === "string" ? change : undefined
  } catch {
    return undefined
  }
}

/** A change is written when made and again when applied: keep the last record per sequence. */
export function mergeTacticChanges(records: readonly TacticChange[]): TacticChange[] {
  const bySequence = new Map<number, TacticChange>()
  for (const record of records) bySequence.set(record.sequence, record)
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence)
}

// ── Where the drawer finds the changes of the match on screen ───────────────

const archivedChanges = new Map<string, TacticChange[]>()

/** Called by every archive loading path with the changes read from the archive. */
export function rememberTacticChanges(matchId: string | undefined, changes: readonly TacticChange[] | undefined) {
  if (!matchId || !changes) return
  archivedChanges.set(matchId, mergeTacticChanges(changes))
}

export function archivedTacticChanges(matchId: string | undefined) {
  return matchId ? archivedChanges.get(matchId) : undefined
}

export type LiveTacticChanges = { matchId?: string | null; status?: string; changes: TacticChange[] }

export async function fetchLiveTacticChanges(apiBase: string, signal?: AbortSignal): Promise<LiveTacticChanges> {
  const response = await fetch(`${apiBase}/api/match/tactics`, { signal })
  if (!response.ok) throw new Error(`tactics ${response.status}`)
  const body = (await response.json()) as LiveTacticChanges
  return { ...body, changes: mergeTacticChanges(body.changes ?? []) }
}

