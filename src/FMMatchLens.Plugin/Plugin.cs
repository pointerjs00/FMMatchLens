using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using FMMatchLens.Plugin.Diagnostics;
using FMMatchLens.Plugin.Memory;
using FMMatchLens.Plugin.Services;
using System.Threading;

namespace FMMatchLens.Plugin;

[BepInPlugin(ProjectMetadata.PluginId, ProjectMetadata.Name, ProjectMetadata.Version)]
public sealed class Plugin : BasePlugin
{
    private LocalApiServer? _apiServer;
    private GameMatchTickHook? _gameMatchTickHook;
    private MatchArchiveStore? _archiveStore;
    private GraphicsAssetIndex? _graphicsAssets;
    private TacticPauseDiff? _tacticPauseDiff;
    private TacticObjectProbe? _tacticObjectProbe;
    private Timer? _hookRetryTimer;
    private int _isInstallingHook;

    internal static ManualLogSource PluginLog { get; private set; } = null!;

    public override void Load()
    {
        PluginLog = Log;
        var options = new PluginOptions(Config);
        if (!PluginLogger.Configure(options.LogMode.Value))
        {
            PluginLogger.Warning(
                $"Unknown logging mode '{options.LogMode.Value}'; falling back to release. " +
                "Use 'release' or 'debug' in com.fmmatchlens.plugin.cfg.");
        }
        ArchiveDiagnostics.Configure(PluginLogger.Debug, PluginLogger.Warning, PluginLogger.Info);

        PluginLogger.Info(
            $"{ProjectMetadata.Name} {ProjectMetadata.Version} loaded " +
            $"for {ProjectMetadata.GameName} {ProjectMetadata.GameVersion} (log mode: {PluginLogger.Mode}).");

        var dataPath = Path.Combine(Paths.PluginPath, "FMMatchLens", "data");
        var archiveOptions = options.GetArchiveWriteOptions();
        _archiveStore = new MatchArchiveStore(Path.Combine(dataPath, "matches"), archiveOptions);
        PluginLogger.Info($"Archive writer compression: {archiveOptions.Compression}, chunk ticks: {archiveOptions.ChunkTicks}.");
        _graphicsAssets = new GraphicsAssetIndex(
            options.GraphicsPath.Value,
            Path.Combine(dataPath, "graphics-index-cache.json"));
        _graphicsAssets.Build();
        var realtimeTimeline = new RealtimeMatchTimeline(_archiveStore, _graphicsAssets);

        _apiServer = new LocalApiServer(realtimeTimeline, _archiveStore, _graphicsAssets);

        _apiServer.Start();
        if (options.TrackTacticChanges.Value)
        {
            try
            {
                TacticChangeTracker.Install(realtimeTimeline);
            }
            catch (Exception ex)
            {
                PluginLogger.Warning($"Tactic tracking could not be installed: {ex.Message}");
            }
        }

        TacticProbe? tacticProbe = null;
        if (options.ResearchTacticProbe.Value)
        {
            tacticProbe = new TacticProbe(Path.Combine(
                dataPath,
                "research",
                $"tactic-probe-{DateTime.Now:yyyyMMdd-HHmmss}.log"));
            PluginLogger.Warning($"Research.TacticProbe is ON; writing tactic memory diffs to {tacticProbe.LogPath}.");
        }

        TacticSignatureScan? tacticScan = null;
        if (options.ResearchTacticScan.Value)
        {
            tacticScan = new TacticSignatureScan(Path.Combine(
                dataPath,
                "research",
                $"tactic-scan-{DateTime.Now:yyyyMMdd-HHmmss}.log"));
            PluginLogger.Warning($"Research.TacticScan is ON; writing tactic signature scans to {tacticScan.LogPath}.");
        }

        _gameMatchTickHook = new GameMatchTickHook(realtimeTimeline, tacticProbe, tacticScan);
        if (options.ResearchTacticObjects.Value)
        {
            _tacticObjectProbe = new TacticObjectProbe(
                Path.Combine(dataPath, "research", $"tactic-objects-{DateTime.Now:yyyyMMdd-HHmmss}.log"));
            _gameMatchTickHook.ObjectProbe = _tacticObjectProbe;
            PluginLogger.Warning($"Research.TacticObjects is ON; log: {_tacticObjectProbe.LogPath}.");
        }
        if (options.ResearchTacticEvents.Value)
        {
            var clockHook = _gameMatchTickHook;
            try
            {
                TacticEventTap.Install(
                    Path.Combine(dataPath, "research", $"tactic-events-{DateTime.Now:yyyyMMdd-HHmmss}.log"),
                    () => clockHook.CurrentClock());
                PluginLogger.Warning($"Research.TacticEvents is ON; log: {TacticEventTap.LogPath}.");
            }
            catch (Exception ex)
            {
                PluginLogger.Warning($"Research.TacticEvents could not be installed: {ex.Message}");
            }
        }

        if (options.ResearchTacticPauseDiff.Value)
        {
            var hook = _gameMatchTickHook;
            _tacticPauseDiff = new TacticPauseDiff(
                Path.Combine(dataPath, "research", $"tactic-pausediff-{DateTime.Now:yyyyMMdd-HHmmss}.log"),
                () => hook.CurrentKnownObjects());
            PluginLogger.Warning($"Research.TacticPauseDiff is ON (F9 snapshot, F11 analyse); log: {_tacticPauseDiff.LogPath}.");
        }
        if (!_gameMatchTickHook.Start())
        {
            if (_gameMatchTickHook.ShouldRetry)
            {
                PluginLogger.Info("GAME_MATCH tick hook will retry while game_plugin.dll build detection is pending.");
                _hookRetryTimer = new Timer(
                    _ => TryInstallGameMatchTickHook(),
                    null,
                    TimeSpan.FromSeconds(1),
                    TimeSpan.FromSeconds(1));
            }
        }
    }

    public override bool Unload()
    {
        _hookRetryTimer?.Dispose();
        _hookRetryTimer = null;
        _gameMatchTickHook?.Stop();
        _tacticPauseDiff?.Dispose();
        _tacticObjectProbe?.Dispose();
        TacticEventTap.Dispose();
        TacticChangeTracker.Uninstall();
        _apiServer?.Stop();
        _archiveStore?.Dispose();
        PluginLogger.Info($"{ProjectMetadata.Name} stopped.");
        return true;
    }

    private void TryInstallGameMatchTickHook()
    {
        if (_gameMatchTickHook is null || _gameMatchTickHook.IsStarted)
        {
            _hookRetryTimer?.Dispose();
            _hookRetryTimer = null;
            return;
        }

        if (Interlocked.Exchange(ref _isInstallingHook, 1) == 1)
        {
            return;
        }

        try
        {
            if (_gameMatchTickHook.Start(false))
            {
                _hookRetryTimer?.Dispose();
                _hookRetryTimer = null;
            }
            else if (!_gameMatchTickHook.ShouldRetry)
            {
                _hookRetryTimer?.Dispose();
                _hookRetryTimer = null;
            }
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"GAME_MATCH tick hook retry failed: {ex.Message}");
        }
        finally
        {
            Interlocked.Exchange(ref _isInstallingHook, 0);
        }
    }

}
