import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from "@/lib/utils"
import type { MatchSnapshot } from "@/types/match"
import {
  analyseMatch,
  dec,
  fullMatchWindow,
  instructionTagLabel,
  pct,
  recentWindow,
  type Insight,
  type InsightTone,
  type MatchAnalysis,
  type PlayerReport,
} from "@/features/analysis/engine"
import type { ArchiveSummary } from "@/api/archiveTypes"
import {
  aggregateMatches,
  analyseArchiveFile,
  analyseServerArchive,
  listServerArchives,
  matchLabel,
  serverArchiveLabel,
  type AnalysedMatch,
} from "@/features/analysis/multiMatch"
import { rolePt } from "@/features/analysis/roles"
import {
  defaultTacticProfile,
  loadTacticProfile,
  mentalityLabels,
  playerInstructionLabels,
  saveTacticProfile,
  teamInstructionDefinitions,
  type PlayerInstructionTag,
  type TacticProfile,
} from "@/features/analysis/tacticProfile"
import { slotLabel } from "@/features/analysis/roles"
import {
  applyTacticChanges,
  archivedTacticChanges,
  changesUpTo,
  fetchLiveTacticChanges,
  reliableComparisonMinutes,
  tacticChangesReport,
  type ComparisonRow,
  type TacticChange,
  type TacticChangesReport,
  type TacticComparison,
  type TacticMoment,
} from "@/features/analysis/tacticChanges"

type TabId = "match" | "players" | "changes" | "tactic" | "season"
type WindowMode = "full" | "recent"

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "match", label: "Jogo" },
  { id: "players", label: "Jogadores" },
  { id: "changes", label: "Alterações" },
  { id: "tactic", label: "Tática" },
  { id: "season", label: "Vários jogos" },
]

/**
 * Live snapshots arrive every 250 ms. The analysis only needs to move with the
 * game clock, so the drawer samples the latest snapshot every couple of seconds
 * (and immediately when the match or minute changes, e.g. on a replay seek).
 */
function useSampledMatch(match: MatchSnapshot, active: boolean, intervalMs = 2_000) {
  const latest = useRef(match)
  const [sampled, setSampled] = useState(match)
  useEffect(() => {
    latest.current = match
  }, [match])
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setSampled(latest.current), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  const stale =
    sampled.matchId !== match.matchId ||
    Math.abs(sampled.clock.minute - match.clock.minute) >= 2
  return active && stale ? match : sampled
}

/**
 * Tactical changes of the match on screen: from the archive it was loaded from, or polled from the
 * plugin while the match is live.
 */
function useTacticChanges(match: MatchSnapshot, active: boolean, apiBase?: string, connectionEnabled?: boolean) {
  const [live, setLive] = useState<{ matchId?: string | null; changes: TacticChange[] }>()
  const archived = archivedTacticChanges(match.matchId)
  const polling = active && !archived && connectionEnabled && !!apiBase
  useEffect(() => {
    if (!polling || !apiBase) return
    const controller = new AbortController()
    const load = () =>
      fetchLiveTacticChanges(apiBase, controller.signal)
        .then(setLive)
        .catch(() => undefined) // older plugin without /api/match/tactics, or plugin closed
    void load()
    const timer = window.setInterval(load, 5_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [polling, apiBase])
  if (archived) return archived
  return live && live.matchId === match.matchId ? live.changes : undefined
}

export function AnalysisDrawer({
  match,
  open,
  onOpenChange,
  apiBase,
  connectionEnabled = false,
}: {
  match: MatchSnapshot
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Plugin API base URL, e.g. http://127.0.0.1:16726. */
  apiBase?: string
  connectionEnabled?: boolean
}) {
  const [tab, setTab] = useState<TabId>("match")
  const [windowMode, setWindowMode] = useState<WindowMode>("full")
  const [profile, setProfile] = useState<TacticProfile>(loadTacticProfile)
  const sampled = useSampledMatch(match, open)
  const tacticChanges = useTacticChanges(sampled, open, apiBase, connectionEnabled)
  // The starting tactic of the "Tática" tab plus the changes detected by the plugin so far.
  const effectiveProfile = useMemo(
    () => (tacticChanges ? applyTacticChanges(profile, changesUpTo(tacticChanges, sampled)) : profile),
    [profile, tacticChanges, sampled]
  )
  const analysis = useMemo(
    () =>
      open
        ? analyseMatch(sampled, effectiveProfile, {
            window: windowMode === "full" ? fullMatchWindow(sampled) : recentWindow(sampled),
          })
        : undefined,
    [open, sampled, effectiveProfile, windowMode]
  )
  const changesReport = useMemo(
    () =>
      open && analysis && tacticChanges
        ? tacticChangesReport(sampled, analysis.side, profile, tacticChanges)
        : undefined,
    [open, analysis, sampled, profile, tacticChanges]
  )
  const updateProfile = (next: TacticProfile) => {
    setProfile(next)
    saveTacticProfile(next)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right" modal={false}>
      <DrawerContent
        data-analysis-drawer
        className="scrollbar-hidden gap-0 overflow-hidden border-0 bg-card py-0 text-card-foreground shadow-2xl ring-1 ring-foreground/10 [--drawer-inset:12px]"
        style={{
          width: "min(640px, calc(100vw - 24px))",
          "--drawer-content-width": "min(640px, calc(100vw - 24px))",
        } as React.CSSProperties}
      >
        <div className="flex h-full min-h-0 w-full flex-col">
          <DrawerHeader className="flex-row items-start gap-3 border-b px-4 py-3">
            <div className="min-w-0 flex-1">
              <DrawerTitle className="text-base font-semibold">Análise tática</DrawerTitle>
              <DrawerDescription className="text-left">
                {analysis
                  ? `${analysis.teamName} ${analysis.goalsFor}-${analysis.goalsAgainst} ${analysis.opponentName} · ${analysis.minute}' · tática "${profile.name}" · ${mentalityLabels[effectiveProfile.mentality]}${tacticChanges ? "" : " (do separador Tática)"}`
                  : "—"}
              </DrawerDescription>
            </div>
            <DrawerClose render={<Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Fechar" />}>
              <span className="text-lg leading-none">×</span>
            </DrawerClose>
          </DrawerHeader>

          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <Segmented value={tab} onChange={setTab} items={tabs} />
            {(tab === "match" || tab === "players") && (
              <Segmented
                value={windowMode}
                onChange={setWindowMode}
                items={[
                  { id: "full", label: "Jogo todo" },
                  { id: "recent", label: "Últimos 15'" },
                ]}
              />
            )}
          </div>

          <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto select-text">
            {analysis && tab === "match" && <MatchTab analysis={analysis} />}
            {analysis && tab === "players" && <PlayersTab analysis={analysis} />}
            {tab === "changes" && <ChangesTab report={changesReport} recorded={tacticChanges != null} />}
            {tab === "tactic" && <TacticTab profile={profile} onChange={updateProfile} />}
            {tab === "season" && (
              <SeasonTab profile={profile} apiBase={apiBase} connectionEnabled={connectionEnabled} />
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T
  onChange: (value: T) => void
  items: Array<{ id: T; label: string }>
}) {
  return (
    <div className="inline-flex rounded-md bg-muted p-0.5" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            "rounded px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors",
            value === item.id && "bg-background text-foreground shadow-xs"
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ── Match tab ────────────────────────────────────────────────────────────

const toneStyles: Record<InsightTone, { dot: string; label: string }> = {
  problem: { dot: "bg-status-negative", label: "A corrigir" },
  warning: { dot: "bg-status-warning", label: "Atenção" },
  info: { dot: "bg-primary", label: "Nota" },
  good: { dot: "bg-status-positive", label: "A correr bem" },
}

function MatchTab({ analysis }: { analysis: MatchAnalysis }) {
  const { metrics, opponent } = analysis
  const fixes = analysis.insights.filter((insight) => insight.tone === "problem" || insight.tone === "warning")
  const notes = analysis.insights.filter((insight) => insight.tone === "info")
  const good = analysis.insights.filter((insight) => insight.tone === "good")
  const enough = analysis.window.toMinute - analysis.window.fromMinute >= 10

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm leading-snug font-medium text-foreground">{analysis.headline}</p>

      <div className="grid grid-cols-4 gap-2">
        <ScoreTile label="Ataque" value={enough ? analysis.scores.attack : undefined} />
        <ScoreTile label="Defesa" value={enough ? analysis.scores.defence : undefined} />
        <ScoreTile label="Pressão" value={enough ? analysis.scores.pressing : undefined} />
        <ScoreTile label="Transições" value={enough ? analysis.scores.transition : undefined} />
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-[11px] tabular-nums">
        <span className="text-right font-semibold">{analysis.teamName}</span>
        <span />
        <span className="font-semibold">{analysis.opponentName}</span>
        <CompareRow label="xG" left={dec(metrics.xg)} right={dec(opponent.xg)} />
        <CompareRow label="Remates (na área)" left={`${metrics.shots} (${metrics.boxShots})`} right={`${opponent.shots} (${opponent.boxShots})`} />
        <CompareRow
          label={metrics.possessionShare != null ? "Posse" : "Quota de passes"}
          left={pct(metrics.possessionShare ?? metrics.passShare)}
          right={pct(opponent.possessionShare ?? opponent.passShare)}
        />
        <CompareRow label="Passes certos" left={pct(metrics.passAccuracy)} right={pct(opponent.passAccuracy)} />
        <CompareRow label="Recuperações altas" left={String(metrics.highRegains)} right={String(opponent.highRegains)} />
        <CompareRow label="Perdas no 1.º terço" left={String(metrics.possessionLostByThird.defensive)} right={String(opponent.possessionLostByThird.defensive)} />
        <CompareRow label="Remates em transição" left={String(metrics.transitionShots)} right={String(opponent.transitionShots)} />
        <CompareRow
          label="Corredores (E/C/D)"
          left={`${pct(metrics.attackLaneShare.left)} ${pct(metrics.attackLaneShare.centre)} ${pct(metrics.attackLaneShare.right)}`}
          right={`${pct(opponent.attackLaneShare.left)} ${pct(opponent.attackLaneShare.centre)} ${pct(opponent.attackLaneShare.right)}`}
        />
      </div>

      {!enough && (
        <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
          Ainda há poucos minutos de jogo neste período; as conclusões aparecem a partir dos 10 minutos.
        </p>
      )}

      <InsightSection title="O que ajustar" insights={fixes} empty="Nada de relevante a corrigir neste período." />
      {notes.length > 0 && <InsightSection title="A ter em conta" insights={notes} />}
      <InsightSection title="O que está a correr bem" insights={good} empty="Ainda sem pontos fortes claros." />

      <p className="pt-2 text-[10px] leading-relaxed text-muted-foreground">
        As sugestões combinam os dados deste jogo com a tua tática e os atributos dos jogadores. São pistas baseadas em
        heurísticas sobre o motor do FM, não garantias: muda uma coisa de cada vez e vê o efeito.
      </p>
    </div>
  )
}

function ScoreTile({ label, value }: { label: string; value?: number }) {
  const tone = value == null ? "" : value >= 65 ? "bg-status-positive" : value >= 45 ? "bg-status-warning" : "bg-status-negative"
  return (
    <div className="rounded-lg border px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-medium text-muted-foreground uppercase">{label}</span>
        <span className="text-base font-semibold tabular-nums">{value ?? "—"}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${value ?? 0}%` }} />
      </div>
    </div>
  )
}

function CompareRow({ label, left, right }: { label: string; left: string; right: string }) {
  return (
    <>
      <span className="text-right">{left}</span>
      <span className="text-center text-muted-foreground">{label}</span>
      <span>{right}</span>
    </>
  )
}

function InsightSection({ title, insights, empty }: { title: string; insights: Insight[]; empty?: string }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {insights.length === 0 ? (
        empty ? <p className="text-[11px] text-muted-foreground">{empty}</p> : null
      ) : (
        insights.map((insight) => <InsightCard key={insight.id} insight={insight} />)
      )}
    </section>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  const style = toneStyles[insight.tone]
  return (
    <article className="rounded-lg border px-3 py-2.5">
      <header className="flex items-start gap-2">
        <span className={cn("mt-1 size-2 shrink-0 rounded-full", style.dot)} aria-label={style.label} />
        <h4 className="text-[13px] leading-snug font-semibold">{insight.title}</h4>
      </header>
      <p className="mt-1 pl-4 text-xs leading-relaxed text-foreground/85">{insight.detail}</p>
      {insight.evidence.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {insight.evidence.map((item) => (
            <li key={item}>· {item}</li>
          ))}
        </ul>
      )}
      {insight.actions.length > 0 && (
        <ul className="mt-2 space-y-1 pl-4 text-xs">
          {insight.actions.map((action) => (
            <li key={action} className="flex gap-1.5">
              <span className="text-primary">→</span>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

// ── Changes tab ──────────────────────────────────────────────────────────

function ChangesTab({ report, recorded }: { report?: TacticChangesReport; recorded: boolean }) {
  if (!recorded) {
    return (
      <p className="m-4 rounded-md bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Sem registo de alterações táticas para este jogo. O plugin grava-as a partir desta versão (opção
        <span className="font-medium"> Tactics.TrackChanges</span>); jogos gravados antes não as têm.
      </p>
    )
  }
  const moments = report?.moments ?? []
  return (
    <div className="space-y-3 p-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Detetadas automaticamente pelo plugin. O FM só aplica uma alteração na paragem de jogo seguinte, por isso a
        comparação começa no minuto em que foi <span className="font-medium">aplicada</span> e vai até à alteração
        seguinte (ou até agora). Com menos de {reliableComparisonMinutes} minutos de um dos lados mostram-se totais,
        sem cores: ainda é cedo para tirar conclusões.
      </p>
      {moments.length === 0 && <p className="text-[11px] text-muted-foreground">Ainda não houve alterações neste jogo.</p>}
      {report?.overall && (
        <article className="rounded-lg border border-primary/40 px-3 py-2.5">
          <h4 className="text-[13px] font-semibold">Efeito do conjunto das alterações</h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Desde a primeira alteração aplicada ({report.overall.fromMinute}') até agora, contra o período anterior.
          </p>
          <ComparisonTable comparison={report.overall.comparison} />
        </article>
      )}
      {[...moments].reverse().map((moment, index) => (
        <MomentCard key={`${moment.minute}-${index}`} moment={moment} />
      ))}
    </div>
  )
}

function MomentCard({ moment }: { moment: TacticMoment }) {
  return (
    <article className="rounded-lg border px-3 py-2.5">
      <header className="flex items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-semibold tabular-nums">
          {moment.pending ? `${moment.madeMinute}' · pendente` : `${moment.minute}'`}
        </h4>
        <span className="text-[10px] text-muted-foreground">
          {moment.pending
            ? "aplica-se na próxima paragem"
            : moment.madeMinute !== moment.minute
              ? `feita aos ${moment.madeMinute}', aplicada aos ${moment.minute}'`
              : `feita e aplicada aos ${moment.minute}'`}
        </span>
      </header>
      <ul className="mt-1 space-y-0.5 text-xs">
        {moment.lines.map((line, index) => (
          <li key={index} className="flex gap-1.5">
            <span className="text-primary">→</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {moment.comparison && <ComparisonTable comparison={moment.comparison} />}
      {moment.tooShortMinutes != null && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Só {moment.tooShortMinutes === 1 ? "1 minuto" : `${moment.tooShortMinutes} minutos`} desde que foi aplicada:
          ainda não há dados para comparar.
        </p>
      )}
    </article>
  )
}

function ComparisonTable({ comparison }: { comparison: TacticComparison }) {
  const vsOpponent = comparison.mode === "vsOpponent"
  const minutes = (value: number) => (value === 1 ? "1 min" : `${value} min`)
  return (
    <>
      <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
        <span className="text-muted-foreground">
          {vsOpponent
            ? `Adversário vs nós, ${comparison.after.label}`
            : `Antes ${comparison.before.label} → depois ${comparison.after.label}`}
        </span>
        <span className="text-right text-muted-foreground">
          {vsOpponent ? "adversário" : `antes (${minutes(comparison.beforeMinutes)})`}
        </span>
        <span className="text-right text-muted-foreground">
          {vsOpponent ? "nós" : `depois (${minutes(comparison.afterMinutes)})`}
        </span>
        {comparison.rows.map((row) => (
          <ComparisonLine key={row.label} row={row} coloured={comparison.reliable} />
        ))}
      </div>
      {vsOpponent && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Alteração logo no início: sem período anterior, compara-se com o adversário nos mesmos minutos.
        </p>
      )}
    </>
  )
}

function formatComparisonValue(row: ComparisonRow, value: number) {
  switch (row.format) {
    case "pct":
      return pct(value)
    case "int":
      return String(Math.round(value))
    case "dec1":
      return dec(value, 1)
    default:
      return dec(value)
  }
}

function ComparisonLine({ row, coloured }: { row: ComparisonRow; coloured: boolean }) {
  const delta = row.after - row.before
  const relevant = Math.abs(delta) > (row.format === "pct" ? 0.03 : row.format === "dec" ? 0.05 : 1)
  const tone =
    !coloured || !relevant || row.better === 0
      ? ""
      : delta * row.better > 0
        ? "text-status-positive"
        : "text-status-negative"
  return (
    <>
      <span>{row.label}</span>
      <span className="text-right">{formatComparisonValue(row, row.before)}</span>
      <span className={cn("text-right font-medium", tone)}>{formatComparisonValue(row, row.after)}</span>
    </>
  )
}

// ── Players tab ──────────────────────────────────────────────────────────

function PlayersTab({ analysis }: { analysis: MatchAnalysis }) {
  const onPitch = analysis.players.filter((player) => player.isOnPitch)
  const off = analysis.players.filter((player) => !player.isOnPitch)
  return (
    <div className="space-y-4 p-4">
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Em campo</h3>
        {onPitch.map((player) => <PlayerCard key={player.id} player={player} />)}
      </section>
      {off.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Já saíram</h3>
          {off.map((player) => <PlayerCard key={player.id} player={player} />)}
        </section>
      )}
    </div>
  )
}

function PlayerCard({ player }: { player: PlayerReport }) {
  const worst = player.notes.some((note) => note.tone === "problem")
    ? "problem"
    : player.notes.some((note) => note.tone === "warning")
      ? "warning"
      : "good"
  return (
    <article className="rounded-lg border px-3 py-2.5">
      <header className="flex items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", toneStyles[worst].dot)} />
        <span className="w-16 shrink-0 text-[10px] font-medium text-muted-foreground">{player.slotLabel}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{player.name}</span>
        {player.condition != null && (
          <span className={cn("text-[11px] tabular-nums", player.condition < 65 ? "text-status-negative" : "text-muted-foreground")}>
            {player.condition}%
          </span>
        )}
        {player.rating != null && (
          <span className="w-9 rounded bg-muted px-1 text-center text-[11px] font-semibold tabular-nums">
            {dec(player.rating, 1)}
          </span>
        )}
      </header>
      <p className="mt-1 pl-4 text-[11px] text-muted-foreground">
        {rolePt(player.roleIn)}
        {player.fitIn ? ` (${dec(player.fitIn.score, 1)})` : ""}
        {" · sem bola: "}
        {rolePt(player.roleOut)}
        {player.fitOut ? ` (${dec(player.fitOut.score, 1)})` : ""}
        {` · ${player.minutes}'`}
      </p>
      {(player.instructions.length > 0 || player.traits.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-4">
          {player.instructions.map((tag) => (
            <span key={tag} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              {instructionTagLabel(tag)}
            </span>
          ))}
          {player.traits.map((trait) => (
            <span key={trait} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {trait}
            </span>
          ))}
        </div>
      )}
      {player.notes.length > 0 && (
        <ul className="mt-2 space-y-1 pl-4 text-xs">
          {player.notes.map((note) => (
            <li key={note.text} className="flex gap-1.5">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", toneStyles[note.tone].dot)} />
              <span className="leading-relaxed">{note.text}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

// ── Tactic tab ───────────────────────────────────────────────────────────

const slotOptions = ["GK", "DL", "DCL", "DCR", "DC", "DR", "WBL", "WBR", "DM", "DMC", "ML", "MR", "MC", "MCL", "MCR", "AML", "AMR", "AMC", "ST"]
const allTags = Object.keys(playerInstructionLabels) as PlayerInstructionTag[]

function TacticTab({ profile, onChange }: { profile: TacticProfile; onChange: (profile: TacticProfile) => void }) {
  const [newSlot, setNewSlot] = useState("")
  const groups = [
    { title: "Com bola", phase: "inPossession" as const },
    { title: "Sem bola", phase: "outOfPossession" as const },
  ]
  const slots = Object.keys(profile.players)
  const setSlotTags = (slot: string, tags: PlayerInstructionTag[]) => {
    const players = { ...profile.players }
    if (tags.length) players[slot] = tags
    else delete players[slot]
    onChange({ ...profile, players })
  }

  return (
    <div className="space-y-5 p-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Tática de partida. O plugin lê a formação e os papéis, e deteta as alterações feitas durante o jogo
        (mentalidade, mudanças rápidas de instruções de equipa, substituições); não consegue ler a tática em si.
        Indica-a aqui uma vez: fica guardada neste browser e a análise aplica-lhe as alterações detetadas
        (separador "Alterações"). Mudanças feitas no ecrã completo de instruções não são identificadas.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-[11px]">
          <span className="text-muted-foreground">Nome</span>
          <input
            value={profile.name}
            onChange={(event) => onChange({ ...profile, name: event.target.value })}
            className="h-8 w-full rounded-md border bg-transparent px-2 text-xs"
          />
        </label>
        <label className="space-y-1 text-[11px]">
          <span className="text-muted-foreground">Mentalidade</span>
          <select
            value={profile.mentality}
            onChange={(event) => onChange({ ...profile, mentality: event.target.value as TacticProfile["mentality"] })}
            className="h-8 w-full rounded-md border bg-card px-2 text-xs"
          >
            {Object.entries(mentalityLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {groups.map((group) => (
        <section key={group.phase} className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Instruções de equipa · {group.title}
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {teamInstructionDefinitions
              .filter((definition) => definition.phase === group.phase)
              .map((definition) => {
                const value = profile.team[definition.id]
                return (
                  <label key={definition.id} className="space-y-0.5 text-[11px]">
                    <span className={cn("text-muted-foreground", value !== definition.defaultValue && "font-semibold text-foreground")}>
                      {definition.label}
                    </span>
                    <select
                      value={value}
                      onChange={(event) =>
                        onChange({ ...profile, team: { ...profile.team, [definition.id]: event.target.value } })
                      }
                      className="h-7 w-full rounded-md border bg-card px-1.5 text-xs"
                    >
                      {definition.options.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )
              })}
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Instruções individuais</h3>
        <p className="text-[11px] text-muted-foreground">
          Por posição. Uma posição exata (ex.: M (C) esq.) tem prioridade sobre a geral (M (C)).
        </p>
        {slots.map((slot) => {
          const tags = profile.players[slot]
          const available = allTags.filter((tag) => !tags.includes(tag))
          return (
            <div key={slot} className="rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-24 text-xs font-semibold">{slotLabel(slot)}</span>
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value) setSlotTags(slot, [...tags, event.target.value as PlayerInstructionTag])
                  }}
                  className="ml-auto h-7 rounded-md border bg-card px-1.5 text-[11px]"
                  aria-label={`Adicionar instrução a ${slotLabel(slot)}`}
                >
                  <option value="">+ instrução</option>
                  {available.map((tag) => (
                    <option key={tag} value={tag}>{playerInstructionLabels[tag]}</option>
                  ))}
                </select>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSlotTags(slot, tags.filter((item) => item !== tag))}
                    className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary hover:bg-status-negative/15 hover:text-status-negative"
                    title="Remover"
                  >
                    {playerInstructionLabels[tag]} ×
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        <div className="flex items-center gap-2">
          <select
            value={newSlot}
            onChange={(event) => setNewSlot(event.target.value)}
            className="h-7 rounded-md border bg-card px-1.5 text-[11px]"
          >
            <option value="">Escolher posição…</option>
            {slotOptions.filter((slot) => !slots.includes(slot)).map((slot) => (
              <option key={slot} value={slot}>{slotLabel(slot)}</option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!newSlot}
            onClick={() => {
              onChange({ ...profile, players: { ...profile.players, [newSlot]: [] } })
              setNewSlot("")
            }}
          >
            Adicionar posição
          </Button>
        </div>
      </section>

      <Button type="button" size="sm" variant="ghost" onClick={() => onChange(defaultTacticProfile)}>
        Repor a tática "{defaultTacticProfile.name}"
      </Button>
    </div>
  )
}

// ── Season tab ───────────────────────────────────────────────────────────

type AnalysisJob = { label: string; run: (signal: AbortSignal) => Promise<AnalysedMatch> }

function SeasonTab({
  profile,
  apiBase,
  connectionEnabled,
}: {
  profile: TacticProfile
  apiBase?: string
  connectionEnabled: boolean
}) {
  const [matches, setMatches] = useState<AnalysedMatch[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [listing, setListing] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const aggregate = useMemo(() => aggregateMatches(matches), [matches])
  const busy = progress != null || listing
  const canUseApi = connectionEnabled && Boolean(apiBase)

  useEffect(() => () => abortRef.current?.abort(), [])

  const runJobs = async (jobs: AnalysisJob[], controller: AbortController) => {
    setProgress({ done: 0, total: jobs.length })
    const results: AnalysedMatch[] = []
    const failures: string[] = []
    for (const [index, job] of jobs.entries()) {
      if (controller.signal.aborted) return
      try {
        results.push(await job.run(controller.signal))
      } catch (error) {
        if (controller.signal.aborted) return
        failures.push(`${job.label}: ${error instanceof Error ? error.message : "erro ao ler"}`)
      }
      setProgress({ done: index + 1, total: jobs.length })
      // Let the browser paint between archives; each one takes a few seconds.
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
    setMatches((current) => {
      const byKey = new Map(current.map((match) => [match.key, match]))
      for (const match of results) byKey.set(match.key, match)
      return [...byKey.values()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    })
    setErrors(failures)
    setProgress(null)
  }

  const start = () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setErrors([])
    setNotice("")
    return controller
  }

  const load = (files: File[]) => {
    const controller = start()
    const jobs = files
      .filter((file) => file.name.toLowerCase().endsWith(".fmlens"))
      .map((file): AnalysisJob => ({ label: file.name, run: () => analyseArchiveFile(file, profile) }))
    return runJobs(jobs, controller)
  }

  const loadFromPlugin = async () => {
    if (!apiBase) return
    const controller = start()
    setListing(true)
    let archives: ArchiveSummary[]
    try {
      archives = await listServerArchives(apiBase, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted)
        setErrors([
          `Não foi possível ler a lista de jogos do plugin (${apiBase}). O jogo está aberto com o plugin ativo? ` +
            (error instanceof Error ? error.message : ""),
        ])
      return
    } finally {
      setListing(false)
    }
    if (!archives.length) {
      setNotice("O plugin ainda não tem jogos terminados gravados.")
      return
    }
    await runJobs(
      archives.map((archive): AnalysisJob => ({
        label: serverArchiveLabel(archive),
        run: (signal) => analyseServerArchive(apiBase, archive, profile, signal),
      })),
      controller
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div
        className="rounded-lg border border-dashed px-4 py-4 text-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void load([...event.dataTransfer.files])
        }}
      >
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Carrega todos os jogos gravados pelo plugin, ou seleciona ficheiros <code>.fmlens</code> (pasta{" "}
          <code>BepInEx/plugins/FMMatchLens/data/matches</code>), para ver os padrões da tua tática ao longo dos jogos.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".fmlens"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ""
            if (files.length) void load(files)
          }}
        />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy || !canUseApi}
            title={canUseApi ? `Lê os jogos terminados de ${apiBase}/api/archives` : "Liga a ligação ao plugin para usar esta opção"}
            onClick={() => void loadFromPlugin()}
          >
            {listing ? "A pedir a lista…" : progress ? `A analisar ${progress.done}/${progress.total}…` : "Carregar do plugin"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            Escolher ficheiros
          </Button>
          {matches.length > 0 && !busy && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setMatches([])}>
              Limpar
            </Button>
          )}
        </div>
      </div>
      {notice && <p className="text-[11px] text-muted-foreground">{notice}</p>}
      {errors.map((error) => (
        <p key={error} className="text-[11px] text-status-negative">{error}</p>
      ))}

      {aggregate && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <ScoreTile label="Ataque" value={aggregate.scores.attack} />
            <ScoreTile label="Defesa" value={aggregate.scores.defence} />
            <ScoreTile label="Pressão" value={aggregate.scores.pressing} />
            <ScoreTile label="Transições" value={aggregate.scores.transition} />
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border px-3 py-2 text-[11px] tabular-nums">
            <Stat label="Jogos" value={`${aggregate.matches} (${aggregate.record.wins}V ${aggregate.record.draws}E ${aggregate.record.losses}D)`} />
            <Stat label="Golos" value={`${aggregate.goalsFor}–${aggregate.goalsAgainst}`} />
            <Stat label="xG a favor / jogo" value={dec(aggregate.xgFor / aggregate.matches)} />
            <Stat label="xG contra / jogo" value={dec(aggregate.xgAgainst / aggregate.matches)} />
            <Stat label="Golos vs xG" value={`${aggregate.goalsFor - aggregate.xgFor >= 0 ? "+" : ""}${dec(aggregate.goalsFor - aggregate.xgFor, 1)}`} />
            {aggregate.possession != null && <Stat label="Posse média" value={pct(aggregate.possession)} />}
            <Stat label="Passes certos" value={pct(aggregate.passAccuracy)} />
            {aggregate.crossAccuracy != null && <Stat label="Cruzamentos certos" value={pct(aggregate.crossAccuracy)} />}
            {aggregate.aerialWinRate != null && <Stat label="Duelos aéreos ganhos" value={pct(aggregate.aerialWinRate)} />}
            <Stat label="Foras de jogo / jogo" value={dec(aggregate.offsidesPerMatch, 1)} />
            <Stat label="Recuperações altas / jogo" value={dec(aggregate.highRegainsPerMatch, 1)} />
            {aggregate.counterPressRate != null && <Stat label="Contra-pressão eficaz" value={pct(aggregate.counterPressRate)} />}
            <Stat label="xG contra em transição / jogo" value={dec(aggregate.transitionXgAgainstPerMatch)} />
            <Stat
              label="Os teus ataques (E/C/D)"
              value={`${pct(aggregate.attackLaneShare.left)} · ${pct(aggregate.attackLaneShare.centre)} · ${pct(aggregate.attackLaneShare.right)}`}
            />
          </div>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Padrões que se repetem</h3>
            {aggregate.recurring.map((item) => (
              <details key={item.id} className="rounded-lg border px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center gap-2">
                  <span className={cn("size-2 shrink-0 rounded-full", toneStyles[item.tone].dot)} />
                  <span className="min-w-0 flex-1 text-[13px] font-semibold">{item.title}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {item.count}/{aggregate.matches} jogos
                  </span>
                </summary>
                <div className="mt-2 space-y-1 pl-4 text-xs">
                  <p className="text-foreground/85">{item.example.detail}</p>
                  {item.example.actions.map((action) => (
                    <p key={action} className="flex gap-1.5"><span className="text-primary">→</span>{action}</p>
                  ))}
                  <p className="text-[11px] text-muted-foreground">Em: {item.matches.join(" · ")}</p>
                </div>
              </details>
            ))}
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Jogadores</h3>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-[11px] tabular-nums">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Jogador</th>
                    <th className="px-2 py-1 text-right font-medium">Jogos</th>
                    <th className="px-2 py-1 text-right font-medium">Min</th>
                    <th className="px-2 py-1 text-right font-medium">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregate.players.map((player) => (
                    <tr key={player.id} className="border-t align-top">
                      <td className="px-2 py-1">
                        <div className="font-medium">{player.name}</div>
                        <div className="text-[10px] text-muted-foreground">{player.roles.map(rolePt).join(", ")}</div>
                        {player.recurringNotes.slice(0, 3).map((note) => (
                          <div key={note.text} className="mt-0.5 flex gap-1 text-[10px]">
                            <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", toneStyles[note.tone].dot)} />
                            <span>{note.text} <span className="text-muted-foreground">({note.count}×)</span></span>
                          </div>
                        ))}
                      </td>
                      <td className="px-2 py-1 text-right">{player.appearances}</td>
                      <td className="px-2 py-1 text-right">{player.minutes}</td>
                      <td className="px-2 py-1 text-right font-semibold">
                        {player.averageRating != null ? dec(player.averageRating, 2) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-1">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Jogos analisados</h3>
            {matches.map((match) => (
              <p key={match.key} className="text-[11px]">
                <span className="font-medium">{matchLabel(match)}</span>
                <span className="text-muted-foreground"> · {match.analysis.headline}</span>
              </p>
            ))}
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/50 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}
