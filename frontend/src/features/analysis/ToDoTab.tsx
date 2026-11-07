import type { MatchSnapshot } from "@/types/match"
import { cn } from "@/lib/utils"
import { playerLabel } from "@/features/analysis/roles"
import {
  instructionLabel,
  mentalityLabels,
  playerInstructionLabels,
  teamInstructionDefinitions,
  type PlayerInstructionTag,
  type TacticProfile,
  type TeamInstructionId,
} from "@/features/analysis/tacticProfile"
import { pendingChanges, type Consolidation, type ConsolidatedChange } from "@/features/analysis/suggestions"

/**
 * "O que mudar": every change the panel suggests, once, as a to-do list — what to change, where in the game,
 * and why. A change disappears when the game shows it was made (the effective tactic already has it).
 */

/** Out-of-possession individual instructions (the player's panel, "Sem Posse de Bola" page). */
const outOfPossessionTags = new Set<PlayerInstructionTag>(["pressMore", "pressLess", "markTighter", "tackleHarder"])

const groups = [
  { title: "Prioritário", hint: "Problemas e o plano para dar a volta", min: 300 },
  { title: "Recomendado", hint: "Avisos e pontos fracos do adversário", min: 150 },
  { title: "A considerar", hint: "Notas com menos peso", min: Number.NEGATIVE_INFINITY },
] as const

function whereInGame(item: ConsolidatedChange, match: MatchSnapshot) {
  const change = item.change
  switch (change.kind) {
    case "team": {
      const definition = teamInstructionDefinitions.find((entry) => entry.id === change.id)!
      const page = definition.phase === "inPossession" ? "Com Posse de Bola" : "Sem Posse de Bola"
      const tile = change.id === "underlap" || change.id === "overlap" ? `Apoiar Corridas com Bola → ${definition.label}` : definition.label
      return `Tácticas → Instruções à Equipa → ${page} → ${tile} → "${instructionLabel(change.id, change.value)}"`
    }
    case "mentality":
      return `Barra de mentalidade (topo do ecrã de tácticas) → "${mentalityLabels[change.value]}"`
    case "player": {
      const player = match.players.find((candidate) => candidate.id === change.playerId)
      const page = outOfPossessionTags.has(change.tag) ? "Sem Posse de Bola" : "Com posse de bola"
      const what = change.add ? `escolher "${playerInstructionLabels[change.tag]}"` : `tirar "${playerInstructionLabels[change.tag]}" (voltar a Padrão/Normal)`
      return `Tácticas → clicar em ${player ? playerLabel(player) : "?"} → instruções do jogador → ${page} → ${what}`
    }
    case "sub": {
      const name = (id: number) => {
        const player = match.players.find((candidate) => candidate.id === id)
        return player ? playerLabel(player) : "?"
      }
      return `Substituições: sai ${name(change.offId)}, entra ${name(change.onId)}`
    }
  }
}

/** The value now, so the item reads "a → b" when it is a team instruction or the mentality. */
function currentValue(item: ConsolidatedChange, profile: TacticProfile) {
  const change = item.change
  if (change.kind === "team") return instructionLabel(change.id, profile.team[change.id as TeamInstructionId])
  if (change.kind === "mentality") return mentalityLabels[profile.mentality]
  return undefined
}

export function ToDoTab({
  consolidation,
  profile,
  match,
  keeps,
}: {
  consolidation?: Consolidation
  profile: TacticProfile
  match: MatchSnapshot
  keeps: ReadonlyMap<TeamInstructionId, string[]>
}) {
  const todo = pendingChanges(consolidation, profile)
  const rejected = consolidation?.rejected ?? []
  return (
    <div className="space-y-4 p-4">
      <p className="rounded-md bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Todas as alterações que o painel sugere agora, uma vez cada, por ordem de importância. Muda uma ou duas de cada vez:
        o jogo só as aplica na paragem seguinte, e o separador "Alterações" mostra depois o efeito. Uma alteração sai desta
        lista quando o painel a deteta no jogo.
      </p>

      {todo.length === 0 && (
        <p className="rounded-lg border px-3 py-3 text-xs">Nada a mudar neste momento.</p>
      )}

      {groups.map((group, index) => {
        const upper = index === 0 ? Number.POSITIVE_INFINITY : groups[index - 1].min
        const items = todo.filter((item) => item.weight >= group.min && item.weight < upper)
        if (!items.length) return null
        return (
          <section key={group.title} className="space-y-2">
            <h3 className="flex items-baseline gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {group.title}
              <span className="font-normal tracking-normal normal-case">· {group.hint}</span>
            </h3>
            {items.map((item) => (
              <ToDoCard key={item.key} item={item} profile={profile} match={match} tone={index} />
            ))}
          </section>
        )
      })}

      {rejected.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Descartadas por contradição</h3>
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            {rejected.map((item) => (
              <li key={item.key}>
                <span className="line-through">{item.label}</span> ({item.sources[0].ruleTitle}) → fica "{item.lostTo.label}".
              </li>
            ))}
          </ul>
        </section>
      )}

      {keeps.size > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Já está bem assim</h3>
          <ul className="space-y-1 text-[11px]">
            {[...keeps].map(([id, rules]) => (
              <li key={id} className="flex gap-1.5">
                <span className="text-status-positive">✓</span>
                <span>
                  <span className="font-medium">
                    {teamInstructionDefinitions.find((entry) => entry.id === id)?.label}: {instructionLabel(id, profile.team[id])}
                  </span>
                  <span className="text-muted-foreground"> — {rules.join(" · ")}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ToDoCard({
  item,
  profile,
  match,
  tone,
}: {
  item: ConsolidatedChange
  profile: TacticProfile
  match: MatchSnapshot
  tone: number
}) {
  const now = currentValue(item, profile)
  return (
    <article
      className={cn(
        "rounded-lg border px-3 py-2.5",
        tone === 0 ? "border-status-negative/50" : tone === 1 ? "border-status-warning/50" : "border-border"
      )}
    >
      <header className="text-[13px] leading-snug font-semibold">
        {item.label}
        {now && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(agora: {now})</span>}
      </header>
      <p className="mt-1 text-[11px] text-primary">Onde: {whereInGame(item, match)}</p>
      <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed">
        {item.sources.map((source) => (
          <li key={source.ruleId}>
            <span className="font-medium">{source.ruleTitle}</span>
            {source.ruleDetail && <span className="text-muted-foreground"> — {source.ruleDetail}</span>}
          </li>
        ))}
      </ul>
    </article>
  )
}
