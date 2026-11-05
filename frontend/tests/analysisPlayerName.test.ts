import { describe, expect, it } from "vitest"
import {
  corruptedShirtNameTeams,
  resolvePlayerDisplayName,
  sanitizedPlayerMetadata,
  type RealtimePlayerMetadata,
} from "@/api/realtimeMatch"

const meta = (
  slot: number,
  team: "home" | "away",
  shirtName: string,
  firstName: string,
  secondName: string,
  commonName?: string
) =>
  ({
    slot, playerId: slot, team, shirtName, firstName, secondName, commonName,
    displayName: commonName ?? `${firstName} ${secondName}`,
  }) as RealtimePlayerMetadata

// Shirt names as read from an FM27 build: UI strings for both squads.
const corrupted = [
  meta(1, "home", "Competições", "Samuel", "Soares"),
  meta(2, "home", "Contrato", "Alexander", "Bah"),
  meta(3, "home", "Mensagens", "Rafael", "Silva", "Rafa"),
  meta(4, "home", "25:13", "Heorhii", "Sudakov"),
  meta(5, "home", "Agenda", "João", "Palhinha"),
  meta(6, "away", "0 pts", "Matyáš", "Vágner"),
  meta(7, "away", "4:4", "Tomáš", "Petrášek"),
  meta(8, "away", "5 pts", "Tomáš", "Wiesner"),
  meta(9, "away", "3:3", "Jakub", "Kučera"),
  meta(10, "away", "Agenda", "Jan", "Král"),
]

const healthy = [
  meta(1, "home", "TRUBIN", "Anatoliy", "Trubin"),
  meta(2, "home", "Rafa", "Rafael", "Silva", "Rafa"),
  meta(3, "home", "Lukebakio", "Dodi", "Lukébakio"),
  meta(4, "home", "Aursnes", "Fredrik", "Aursnes"),
  meta(5, "home", "SCORER", "Sample", "Player"),
]

describe("player display names", () => {
  it("detects squads whose shirt names are UI strings", () => {
    expect([...corruptedShirtNameTeams(corrupted)].sort()).toEqual(["away", "home"])
    expect(corruptedShirtNameTeams(healthy).size).toBe(0)
  })

  it("falls back to the common name, then the surname, for a corrupted squad", () => {
    const names = sanitizedPlayerMetadata(corrupted).map((player) => resolvePlayerDisplayName(player, player.playerId))
    expect(names.slice(0, 5)).toEqual(["Soares", "Bah", "Rafa", "Sudakov", "Palhinha"])
    expect(names[5]).toBe("Vágner")
  })

  it("keeps genuine and custom shirt names", () => {
    const names = sanitizedPlayerMetadata(healthy).map((player) => resolvePlayerDisplayName(player, player.playerId))
    expect(names).toEqual(["TRUBIN", "Rafa", "Lukebakio", "Aursnes", "SCORER"])
  })
})
