using BepInEx.Configuration;

namespace FMMatchLens.Plugin.Services;

internal sealed class PluginOptions
{
    public PluginOptions(ConfigFile config)
    {
        LogMode = config.Bind(
            "Logging",
            "Mode",
            "release",
            "Log output mode: release writes only key lifecycle data and warnings/errors; debug also writes detailed diagnostics.");

        GraphicsPath = config.Bind(
            "Graphics",
            "GraphicsPath",
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "Sports Interactive",
                "Football Manager 26",
                "graphics"),
            "Root directory containing Football Manager graphics packs and their config.xml files.");

        ArchiveCompression = config.Bind(
            "Archive",
            "Compression",
            "Fast",
            "Archive chunk compression: None or Fast (independent zlib-wrapped Deflate chunks).");

        ArchiveChunkTicks = config.Bind(
            "Archive",
            "ChunkTicks",
            2_400,
            "Maximum number of captured ticks in each independently recoverable archive chunk. At 4 ticks per second, this is about 10 in-game minutes.");

        ArchiveMaxChunkLatencyMs = config.Bind(
            "Archive",
            "MaxChunkLatencyMs",
            60_000,
            "Maximum time before a partial archive chunk is submitted to the background writer. At 60 seconds, the tick limit normally seals the chunk first.");

        ArchiveQueueCapacity = config.Bind(
            "Archive",
            "QueueCapacity",
            8,
            "Bounded archive writer queue capacity. A sustained overflow stops the current archive explicitly.");

        TrackTacticChanges = config.Bind(
            "Tactics",
            "TrackChanges",
            true,
            "Record the human manager's tactical changes during a match (mentality, team instruction quick changes, " +
            "individual instruction steps, swaps and confirmations) with the match minute, in the archive and at " +
            "/api/match/tactics. Reads what the game UI sends to the native game (Harmony on two game methods).");

        ResearchTacticProbe = config.Bind(
            "Research",
            "TacticProbe",
            false,
            "Research only: once per second, log which bytes of the match, team and player tactic memory changed " +
            "(data/research/tactic-probe-*.log). Used to locate live tactic instructions. Leave false for normal play.");

        ResearchTacticScan = config.Bind(
            "Research",
            "TacticScan",
            false,
            "Research only: at game minutes 2 and 50, scan process memory for FM's team-instruction option ids and " +
            "report the tactic structures found (data/research/tactic-scan-*.log). Takes a few seconds on a " +
            "background thread. Leave false for normal play.");

        ResearchTacticPauseDiff = config.Bind(
            "Research",
            "TacticPauseDiff",
            false,
            "Research only: with the match paused, F9 snapshots process memory and F11 analyses the series to find " +
            "where the selected tactic lives (data/research/tactic-pausediff-*.log). A beep marks each finished step. " +
            "Leave false for normal play.");

        ResearchTacticEvents = config.Bind(
            "Research",
            "TacticEvents",
            false,
            "Research only: log every event the game UI sends to the native game (GamePlugin.SendEvent), with match " +
            "clock, to see how tactical changes travel (data/research/tactic-events-*.log). Uses Harmony on game " +
            "methods. Leave false for normal play.");

        ResearchTacticObjects = config.Bind(
            "Research",
            "TacticObjects",
            false,
            "Research only: follow the engine's per-player objects pointed to from Team+0xF00…0x1600 (both teams), " +
            "dumping them when reallocated and logging changed words (data/research/tactic-objects-*.log). " +
            "Leave false for normal play.");
    }

    public ConfigEntry<bool> TrackTacticChanges { get; }

    public ConfigEntry<bool> ResearchTacticScan { get; }

    public ConfigEntry<bool> ResearchTacticPauseDiff { get; }

    public ConfigEntry<bool> ResearchTacticEvents { get; }

    public ConfigEntry<bool> ResearchTacticObjects { get; }

    public ConfigEntry<bool> ResearchTacticProbe { get; }

    public ConfigEntry<string> LogMode { get; }

    public ConfigEntry<string> GraphicsPath { get; }

    public ConfigEntry<string> ArchiveCompression { get; }

    public ConfigEntry<int> ArchiveChunkTicks { get; }

    public ConfigEntry<int> ArchiveMaxChunkLatencyMs { get; }

    public ConfigEntry<int> ArchiveQueueCapacity { get; }

    public ArchiveWriteOptions GetArchiveWriteOptions()
    {
        var compression = string.Equals(ArchiveCompression.Value, "None", StringComparison.OrdinalIgnoreCase)
            ? global::FMMatchLens.Plugin.Services.ArchiveCompression.None
            : global::FMMatchLens.Plugin.Services.ArchiveCompression.Deflate;
        return new ArchiveWriteOptions(
            compression,
            Math.Clamp(ArchiveChunkTicks.Value, 1, 4_096),
            Math.Clamp(ArchiveMaxChunkLatencyMs.Value, 100, 60_000),
            Math.Clamp(ArchiveQueueCapacity.Value, 1, 64));
    }
}
