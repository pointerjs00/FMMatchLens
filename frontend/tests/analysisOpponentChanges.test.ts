import { describe, expect, it } from "vitest"
import type { RealtimeFrame, RealtimeMomentumEvent } from "@/api/realtimeMatch"
import type { FormationSnapshot, HeatmapGrid, MatchPlayer, MatchSnapshot, TacticalEventPoint, TeamSide } from "@/types/match"
import { fieldMatchups } from "@/features/analysis/matchups"
import { formationLabel, opponentChanges } from "@/features/analysis/opponentChanges"
import { ProximityTracker } from "@/features/analysis/proximity"

function player(id: number, team: TeamSide, inSlot: string, outSlot = inSlot, extra: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    id,
    name: `P${id}`,
    team,
    position: inSlot,
    isStarter: true,
    isOnPitch: true,
    inPossession: { position: inSlot, role: "Role A" },
    outOfPossession: { position: outSlot, role: "Role A" },
    stats: { goals: 0, assists: 0 },
    ...extra,
  } as unknown as MatchPlayer
}

function snapshot(extra: Partial<MatchSnapshot>): MatchSnapshot {
  return {
    matchId: "m",
    clock: { minute: 50, second: 0, elapsedMinute: 50, elapsedSecond: 0, elapsedTick: 12_000 },
    period: 2,
    score: { home: 0, away: 0 },
    home: { name: "Benfica", manager: { isHumanControlled: true }, stats: {} },
    away: { name: "Nacional", stats: {} },
    players: [],
    events: [],
    xgTimeline: [],
    heatmaps: { grids: new Map(), revision: 0 },
    tacticalEvents: [],
    xgShots: [],
    momentum: [],
    rollingMomentum: [],
    ...extra,
  } as unknown as MatchSnapshot
}

const fourTwoThreeOne = ["DL", "DCL", "DCR", "DR", "DML", "DMR", "AML", "AMC", "AMR", "ST"]

describe("closest opponent at the tick of an event", () => {
  const frame = (tick: number, players: Array<[number, TeamSide, number, number]>) =>
    ({
      tick,
      players: players.map(([playerId, team, x, y]) => ({ playerId, team, x, y, isOnPitch: true })),
    }) as unknown as RealtimeFrame
  const point = { id: "e", metricId: "dribblesCompleted", playerId: 1, team: "home", tick: 100 } as TacticalEventPoint
  const event = (tick: number) => ({ tick, playerId: 1 }) as RealtimeMomentumEvent

  it("finds the nearest player of the other team where everyone stood at that tick", () => {
    const tracker = new ProximityTracker()
    tracker.appendFrame(frame(100, [[1, "home", 0, 0], [2, "home", 1, 0], [11, "away", 3, 4], [12, "away", 10, 0]]))
    tracker.appendFrame(frame(101, [[1, "home", 20, 20], [11, "away", 0, 0], [12, "away", 21, 20]]))
    expect(tracker.annotate(point, event(100))).toMatchObject({ nearestOpponentId: 11, nearestOpponentDistance: 5 })
  })

  it("leaves the event alone when that moment is no longer kept", () => {
    const tracker = new ProximityTracker()
    tracker.appendFrame(frame(1_000, [[1, "home", 0, 0], [11, "away", 1, 0]]))
    expect(tracker.annotate(point, event(100))?.nearestOpponentId).toBeUndefined()
  })
})

describe("duels from the closest opponent", () => {
  function grid(column: number, row: number): HeatmapGrid {
    const density = new Float32Array(40 * 60)
    for (let y = row * 5; y < row * 5 + 5; y += 1) for (let x = column * 5; x < column * 5 + 5; x += 1) density[y * 40 + x] = 40
    return { width: 40, height: 60, density, sampleCount: 1000, averageX: column * 12.5 + 6, averageY: row * 8.33 + 4 }
  }

  it("counts a duel only with an opponent close enough for that action", () => {
    const players = [player(9, "home", "GK"), player(1, "home", "AML"), player(11, "away", "DR"), player(12, "away", "DMR")]
    const event = (id: number, metricId: TacticalEventPoint["metricId"], opponent: number, distance: number) =>
      ({ id: String(id), playerId: 1, team: "home", metricId, x: 71, y: 18, tick: id, displayTick: id, minute: 30, nativeEventType: 0, flags: 0, nearestOpponentId: opponent, nearestOpponentDistance: distance }) as TacticalEventPoint
    const match = snapshot({
      players,
      heatmaps: {
        grids: new Map([
          ["player:9:all:full", grid(4, 11)],
          ["player:1:inPossession:full", grid(1, 3)],
          ["player:11:outOfPossession:full", grid(1, 3)],
          ["player:12:outOfPossession:full", grid(3, 5)],
        ]),
        revision: 1,
      },
      tacticalEvents: [
        event(1, "dribblesCompleted", 11, 2.4),
        event(2, "possessionLost", 11, 1.5),
        event(3, "possessionLost", 11, 9), // a pass with nobody near: not a duel
        event(4, "dribblesCompleted", 12, 3), // a duel with a player he does not usually face
      ],
    })
    const field = fieldMatchups(match, "home")!
    expect(field.pair(1, 11)?.duels).toMatchObject({ dribbles: 1, lost: 1 })
    expect(field.pair(1, 12)?.duels).toMatchObject({ dribbles: 1 })
    expect(field.duelPairs).toHaveLength(2)
  })
})

describe("what the opponent changed", () => {
  const lineup = (slots: string[], roles: string[] = []) =>
    slots.map((slot, index) =>
      player(100 + index, "away", slot, slot, {
        inPossession: { position: slot, role: roles[index] ?? "Role A" },
      } as Partial<MatchPlayer>)
    )
  const entry = (minute: number, players: MatchPlayer[]): FormationSnapshot => ({ tick: minute * 240, minute, players })

  it("names formations by lines", () => {
    expect(formationLabel(lineup(fourTwoThreeOne), "inPossession")).toBe("4-2-3-1")
  })

  it("reports formation and role changes and ignores the moment of a substitution", () => {
    const midSub = lineup(fourTwoThreeOne)
    midSub[9] = { ...midSub[9], inPossession: undefined, outOfPossession: undefined } as MatchPlayer
    const fiveBack = lineup(["WBL", "DCL", "DC", "DCR", "WBR", "MCL", "MCR", "AMC", "STL", "STR"])
    const roleChange = lineup(fiveBack.map((item) => item.inPossession!.position!), ["Role B"])
    const changes = opponentChanges(
      snapshot({
        formationSnapshots: [entry(0, lineup(fourTwoThreeOne)), entry(20, midSub), entry(21, lineup(fourTwoThreeOne)), entry(60, fiveBack), entry(70, roleChange)],
      }),
      "home"
    )
    expect(changes.map((change) => [change.minute, change.kind, change.title])).toEqual([
      [60, "formation", "Passou de 4-2-3-1 para 5-2-1-2 sem bola"],
      [60, "formation", "Passou de 4-2-3-1 para 5-2-1-2 com bola"],
      [70, "role", "P100 mudou de papel com bola"],
    ])
  })

  it("classifies substitutions by how far forward the new player plays", () => {
    const off = player(1, "away", "DMR", "DMR", { status: { subbedOffMinute: 65 }, isOnPitch: false } as Partial<MatchPlayer>)
    const on = player(2, "away", "ST", "ST", { isStarter: false, status: { subbedOnMinute: 65 } } as Partial<MatchPlayer>)
    const [change] = opponentChanges(snapshot({ players: [off, on] }), "home")
    expect(change).toMatchObject({ minute: 65, kind: "sub", title: "Substituição ofensiva" })
    expect(change.detail).toBe("Entrou P2 (PL) para o lugar de P1 (MD dir.).")
  })
})
