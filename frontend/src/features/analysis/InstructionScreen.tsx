import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  gameInstructionScreen,
  instructionLabel,
  teamInstructionDefinitions,
  type TacticProfile,
  type TeamInstructionId,
} from "@/features/analysis/tacticProfile"
import type { Consolidation, ConsolidatedChange } from "@/features/analysis/suggestions"

/**
 * The game's "Instruções à Equipa" screen, tile by tile and in the game's order, with what the panel says
 * about each one: change it (to what, and why), confirmed as it is, or nothing to say.
 */

type Phase = keyof typeof gameInstructionScreen
type TileState = { change?: ConsolidatedChange; keptBy?: string[] }

const definition = (id: TeamInstructionId) => teamInstructionDefinitions.find((item) => item.id === id)!

/** "Apoiar Corridas com Bola" holds two choices; the tile shows the underlap one, like the game. */
const tileTitle = (id: TeamInstructionId) => (id === "underlap" ? "Apoiar Corridas com Bola" : definition(id).label)

export function InstructionScreen({
  profile,
  consolidation,
  keeps,
  readFromGame,
}: {
  profile: TacticProfile
  consolidation?: Consolidation
  keeps: ReadonlyMap<TeamInstructionId, string[]>
  /** Instructions read from the game's screens (the rest comes from the starting tactic). */
  readFromGame: ReadonlySet<TeamInstructionId>
}) {
  const [phase, setPhase] = useState<Phase>("inPossession")
  const [onlyChanges, setOnlyChanges] = useState(false)
  const changes = new Map<TeamInstructionId, ConsolidatedChange>()
  for (const item of consolidation?.changes ?? []) {
    if (item.change.kind !== "team") continue
    // The overlap choice lives on the same tile as the underlap one.
    changes.set(item.change.id === "overlap" ? "underlap" : item.change.id, item)
  }
  const state = (id: TeamInstructionId): TileState => ({ change: changes.get(id), keptBy: keeps.get(id) })
  const count = (which: Phase) => {
    const ids = gameInstructionScreen[which]
    return {
      change: ids.filter((id) => state(id).change).length,
      kept: ids.filter((id) => !state(id).change && state(id).keptBy).length,
    }
  }
  const ids = gameInstructionScreen[phase].filter((id) => !onlyChanges || state(id).change)

  return (
    <section className="space-y-2 rounded-lg border px-3 py-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Instruções à Equipa</h3>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground select-none">
          <input type="checkbox" checked={onlyChanges} onChange={(event) => setOnlyChanges(event.target.checked)} />
          Só o que mudar
        </label>
      </header>
      <div className="inline-flex rounded-md bg-muted p-0.5" role="tablist">
        {(["inPossession", "outOfPossession"] as const).map((item) => {
          const { change, kept } = count(item)
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={phase === item}
              onClick={() => setPhase(item)}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors",
                phase === item && "bg-background text-foreground shadow-xs"
              )}
            >
              {item === "inPossession" ? "Com Posse de Bola" : "Sem Posse de Bola"}
              {change > 0 && (
                <span className="ml-1 rounded-full bg-status-warning/20 px-1.5 text-[10px] font-semibold text-status-warning tabular-nums">
                  {change} a mudar
                </span>
              )}
              {kept > 0 && (
                <span className="ml-1 rounded-full bg-status-positive/15 px-1.5 text-[10px] font-semibold text-status-positive tabular-nums">
                  {kept} ✓
                </span>
              )}
            </button>
          )
        })}
      </div>
      {ids.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nada a mudar nesta fase.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ids.map((id) => (
            <Tile key={id} id={id} profile={profile} state={state(id)} read={readFromGame.has(id)} />
          ))}
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Os mesmos mosaicos e a mesma ordem do ecrã do jogo (Tácticas → Instruções à Equipa).
        <span className="text-status-warning"> Laranja</span>: o painel sugere mudar.
        <span className="text-status-positive"> Verde</span>: uma regra confirma que está bem assim. Sem cor: sem indicação.
      </p>
    </section>
  )
}

function Tile({ id, profile, state, read }: { id: TeamInstructionId; profile: TacticProfile; state: TileState; read: boolean }) {
  const { change, keptBy } = state
  const target = change?.change.kind === "team" ? change.change : undefined
  return (
    <article
      className={cn(
        "flex min-h-[86px] flex-col rounded-md border px-2 py-1.5",
        change ? "border-status-warning/70 bg-status-warning/5" : keptBy ? "border-status-positive/50 bg-status-positive/5" : "bg-muted/20"
      )}
      title={change ? change.sources.map((source) => source.ruleTitle).join(" · ") : keptBy?.join(" · ")}
    >
      <h4 className="truncate text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {tileTitle(id)}
      </h4>
      <p className={cn("mt-auto text-xs", target && "text-muted-foreground line-through decoration-muted-foreground/60")}>
        {instructionLabel(id, profile.team[id])}
      </p>
      {id === "underlap" && (
        <p className="text-[10px] text-muted-foreground">Sobreposição: {instructionLabel("overlap", profile.team.overlap)}</p>
      )}
      {target && (
        <p className="text-xs font-semibold text-status-warning">
          → {target.id === "overlap" ? `Sobreposição: ${instructionLabel("overlap", target.value)}` : instructionLabel(target.id, target.value)}
        </p>
      )}
      {change && (
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
          {change.sources[0].ruleTitle}
          {change.sources.length > 1 ? ` (+${change.sources.length - 1})` : ""}
        </p>
      )}
      {!change && keptBy && (
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-status-positive">✓ {keptBy[0]}</p>
      )}
      {!change && !keptBy && !read && <p className="mt-0.5 text-[9px] text-muted-foreground/70">da tática de partida</p>}
    </article>
  )
}
