import { afterEach, describe, expect, it, vi } from "vitest"
import type { ArchiveSummary } from "@/api/archiveTypes"
import { listServerArchives, serverArchiveLabel } from "@/features/analysis/multiMatch"

function summary(id: number, overrides: Partial<ArchiveSummary> = {}): ArchiveSummary {
  return {
    matchId: `match-${id}`,
    fileName: `match-${id}.fmlens`,
    startedUnixMilliseconds: id,
    ended: true,
    frameCount: 100,
    firstTick: 1,
    lastTick: 100,
    homeGoals: 0,
    awayGoals: 0,
    fileSizeBytes: 1,
    ...overrides,
  }
}

/** Mimics the plugin: pageSize is clamped to 50 and an out-of-range page returns the last one. */
function stubArchiveList(all: ArchiveSummary[]) {
  const requested: string[] = []
  vi.stubGlobal("fetch", async (url: string) => {
    requested.push(url)
    const query = new URL(url).searchParams
    const pageSize = Math.min(50, Number(query.get("pageSize")))
    const pageCount = Math.max(1, Math.ceil(all.length / pageSize))
    const page = Math.min(Number(query.get("page")), pageCount - 1)
    return Response.json({
      items: all.slice(page * pageSize, (page + 1) * pageSize),
      page,
      pageSize,
      totalCount: all.length,
      pageCount,
    })
  })
  return requested
}

describe("plugin archive list for the multi-match analysis", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("walks every page and keeps only finished matches", async () => {
    const all = Array.from({ length: 120 }, (_, index) => summary(index, { ended: index !== 3 }))
    const requested = stubArchiveList(all)

    const archives = await listServerArchives("http://127.0.0.1:16726")

    expect(requested).toEqual([
      "http://127.0.0.1:16726/api/archives?page=0&pageSize=50",
      "http://127.0.0.1:16726/api/archives?page=1&pageSize=50",
      "http://127.0.0.1:16726/api/archives?page=2&pageSize=50",
    ])
    expect(archives).toHaveLength(119)
    expect(archives.some((archive) => archive.matchId === "match-3")).toBe(false)
  })

  it("stops after one request when the plugin has no archives", async () => {
    const requested = stubArchiveList([])
    expect(await listServerArchives("http://plugin")).toEqual([])
    expect(requested).toHaveLength(1)
  })

  it("reports an HTTP failure instead of returning an empty list", async () => {
    vi.stubGlobal("fetch", async () => new Response("Internal server error", { status: 500 }))
    await expect(listServerArchives("http://plugin")).rejects.toThrow("500")
  })

  it("labels a match by teams and score, falling back to the file name", () => {
    expect(serverArchiveLabel(summary(1, { homeName: "Alverca", awayName: "Benfica", homeGoals: 1, awayGoals: 1 }))).toBe(
      "Alverca 1-1 Benfica"
    )
    expect(serverArchiveLabel(summary(2))).toBe("match-2.fmlens")
  })
})
