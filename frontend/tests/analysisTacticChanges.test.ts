import { describe, expect, it } from "vitest"
import type { MatchSnapshot } from "@/types/match"
import {
  applyTacticChanges,
  changesUpTo,
  decodeTacticChangeRecord,
  describeTacticChange,
  mergeTacticChanges,
  tacticChangesReport,
  type TacticChange,
} from "@/features/analysis/tacticChanges"
import { defaultTacticProfile } from "@/features/analysis/tacticProfile"

const encoder = new TextEncoder()

function change(
  sequence: number,
  kind: TacticChange["kind"],
  minute: number,
  appliedMinute: number | null,
  extra: Partial<TacticChange> = {}
): TacticChange {
  return {
    sequence,
    kind,
    capturedUnixMilliseconds: 0,
    tick: minute * 240,
    displayTick: minute * 240,
    appliedTick: appliedMinute == null ? null : appliedMinute * 240,
    appliedDisplayTick: appliedMinute == null ? null : appliedMinute * 240,
    ...extra,
  }
}

function snapshotAt(minute: number): MatchSnapshot {
  return {
    matchId: "match-1",
    clock: { minute, second: 0, elapsedMinute: minute, elapsedSecond: 0, elapsedTick: minute * 240 },
    period: minute > 45 ? 2 : 1,
    score: { home: 0, away: 0 },
    home: { name: "Benfica", manager: { isHumanControlled: true }, stats: {} },
    away: { name: "Nacional", stats: {} },
    players: [],
    events: [],
    xgTimeline: [],
    heatmaps: {},
    tacticalEvents: [],
    xgShots: [],
    momentum: [],
    rollingMomentum: [],
  } as unknown as MatchSnapshot
}

describe("tactic change records", () => {
  it("decodes the plugin's JSON payload (camelCase, nulls omitted)", () => {
    const payload = encoder.encode(
      '{"v":1,"change":{"sequence":1,"kind":"mentality","capturedUnixMilliseconds":1794008924312,"tick":0,' +
        '"displayTick":0,"appliedTick":0,"appliedDisplayTick":0,"mentality":5,"mentalityName":"Positiva","initial":true}}'
    )
    expect(decodeTacticChangeRecord(payload)).toMatchObject({ sequence: 1, kind: "mentality", mentality: 5, initial: true })
  })

  it("ignores unknown versions and broken payloads", () => {
    expect(decodeTacticChangeRecord(encoder.encode('{"v":2,"change":{"sequence":1,"kind":"swap"}}'))).toBeUndefined()
    expect(decodeTacticChangeRecord(encoder.encode("{not json"))).toBeUndefined()
  })

  it("keeps the last record of each change (made, then applied)", () => {
    const made = change(2, "swap", 30, null)
    const applied = change(2, "swap", 30, 31)
    expect(mergeTacticChanges([change(1, "confirmed", 10, 11), made, applied])).toEqual([change(1, "confirmed", 10, 11), applied])
  })
})

describe("effective tactic", () => {
  const changes = [
    change(1, "mentality", 0, 0, { mentality: 5, mentalityName: "Positiva", initial: true }),
    change(2, "teamInstruction", 30, 31, { instruction: 21, steps: -3 }),
    change(3, "mentality", 60, null, { mentality: 6, mentalityName: "Atacar", previousMentality: 5 }),
  ]

  it("applies the detected mentality and quick-change steps to the starting tactic", () => {
    const start = { ...defaultTacticProfile, mentality: "balanced" as const, team: { ...defaultTacticProfile.team, tempo: "higher" } }
    const result = applyTacticChanges(start, changes)
    expect(result.mentality).toBe("attacking")
    expect(result.team.tempo).toBe("muchLower")
    expect(applyTacticChanges(start, changes, true).mentality).toBe("positive")
    // Steps beyond the ends of the option list are clamped.
    expect(applyTacticChanges(start, [change(4, "teamInstruction", 1, 2, { instruction: 21, steps: 9 })]).team.tempo).toBe("muchHigher")
  })

  it("describes changes with the game's option names", () => {
    expect(describeTacticChange(changes[1], defaultTacticProfile)).toBe("Ritmo: Mais rápido → Muito mais lento")
    expect(describeTacticChange(changes[2])).toBe("Mentalidade: Positiva → Atacar")
    expect(describeTacticChange(change(5, "teamInstruction", 1, 2, { instruction: 28, steps: 1 }))).toBe(
      "Corridas de apoio: +1 nível"
    )
  })

  it("only shows changes made up to the replay position", () => {
    expect(changesUpTo(changes, snapshotAt(45)).map((item) => item.sequence)).toEqual([1, 2])
  })
})

describe("before/after moments", () => {
  const changes = [
    change(1, "mentality", 0, 0, { mentality: 5, initial: true }),
    change(2, "teamInstruction", 30, 31, { instruction: 21, steps: -3 }),
    change(3, "swap", 30, 31),
    change(4, "mentality", 60, 62, { mentality: 6, previousMentality: 5 }),
    change(5, "playerInstruction", 79, null, { steps: 1, stepCount: 1 }),
  ]

  it("groups changes applied at the same stoppage and compares from the applied minute", () => {
    const { moments, overall } = tacticChangesReport(snapshotAt(80), "home", defaultTacticProfile, changes)
    expect(moments.map((moment) => [moment.minute, moment.madeMinute, moment.pending, moment.lines.length])).toEqual([
      [31, 30, false, 2],
      [62, 60, false, 1],
      [79, 79, true, 1],
    ])
    expect(moments[0].comparison).toMatchObject({
      mode: "beforeAfter",
      before: { fromMinute: 0, toMinute: 30 },
      after: { fromMinute: 31, toMinute: 61 },
      perNinety: true,
      reliable: true,
    })
    expect(moments[0].comparison?.rows[0].label).toBe("xG por 90'")
    expect(moments[1].comparison?.after).toMatchObject({ fromMinute: 62, toMinute: 80 })
    expect(moments[2].comparison).toBeUndefined()
    expect(overall).toMatchObject({ fromMinute: 31, comparison: { after: { fromMinute: 31, toMinute: 80 } } })
  })

  it("shows totals without verdict colours when a side has fewer than 8 minutes", () => {
    const { moments } = tacticChangesReport(snapshotAt(36), "home", defaultTacticProfile, changes)
    expect(moments[0].comparison).toMatchObject({ perNinety: false, reliable: false, afterMinutes: 6 })
    expect(moments[0].comparison?.rows[0].label).toBe("xG")
  })

  it("waits for 3 minutes after the change before comparing", () => {
    const { moments } = tacticChangesReport(snapshotAt(32), "home", defaultTacticProfile, changes)
    expect(moments[0].comparison).toBeUndefined()
    expect(moments[0].tooShortMinutes).toBe(2)
  })

  it("compares with the opponent when the change came in the first minutes", () => {
    const early = [change(1, "mentality", 0, 1, { mentality: 6, previousMentality: 5 })]
    const { moments, overall } = tacticChangesReport(snapshotAt(20), "home", defaultTacticProfile, early)
    expect(moments[0].comparison).toMatchObject({ mode: "vsOpponent", after: { fromMinute: 1, toMinute: 20 } })
    expect(overall).toBeUndefined()
  })
})
