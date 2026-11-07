using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// Research-only scan (config <c>Research.TacticScan</c>, off by default) that locates the
/// live tactic by signature instead of by diffing.
///
/// FM.UI's <c>TacticTeamInstructionOptions</c> enum gives every team-instruction option a unique
/// 32-bit id (e.g. HigherTempo = 0x50304232). Twice per match (game minutes 2 and 50) this scans
/// all private read/write memory of the process for those ids, groups nearby hits into
/// clusters, and reports clusters that hold options of many different instructions — almost
/// certainly tactic structures. It then searches for pointers into each cluster and says
/// whether the pointer lives in a structure the plugin already knows (match, team, player).
///
/// Memory is read with ReadProcessMemory on our own process, which fails cleanly on pages that
/// are freed concurrently instead of faulting. Runs on a low-priority background thread.
/// </summary>
internal sealed class TacticSignatureScan : IDisposable
{
    private const int ChunkBytes = 4 * 1024 * 1024;
    private const int ClusterGap = 0x200;
    private const int MinCategories = 5;
    private const int MaxHits = 500_000;
    private const int MaxReportedClusters = 24;
    private const int MaxHoldersPerCluster = 48;
    private const int DumpMargin = 0x100;
    private static readonly int[] ScanMinutes = { 2, 50 };

    private static readonly Dictionary<uint, (string Category, string Option)> Options = new()
    {
        [1985571685] = ("PassingDirectness", "PassingStyleMuchShorter"),
        [1146434657] = ("PassingDirectness", "PassingStyleShorter"),
        [1483944022] = ("PassingDirectness", "PassingDirectnessNone"),
        [2019653698] = ("PassingDirectness", "PassingStyleMoreDirect"),
        [1867543624] = ("PassingDirectness", "PassingStyleMuchMoreDirect"),
        [1498756423] = ("Tempo", "MuchLowerTempo"),
        [1311996258] = ("Tempo", "LowerTempo"),
        [1496610426] = ("Tempo", "TempoNone"),
        [1345339954] = ("Tempo", "HigherTempo"),
        [543778113] = ("Tempo", "MuchHigherTempo"),
        [1315850041] = ("TimeWasting", "WasteTimeLessOften"),
        [1329030726] = ("TimeWasting", "WasteTimeStandard"),
        [1733973351] = ("TimeWasting", "WasteTimeMoreOften"),
        [1734436950] = ("AttackingTransition", "AttackTransitionCounter"),
        [846284410] = ("AttackingTransition", "AttackingTransitionNone"),
        [1450726497] = ("AttackingTransition", "AttackTransitionHoldShape"),
        [1716541542] = ("TeamWidth", "SetupMuchNarrowerInPossession"),
        [1111652208] = ("TeamWidth", "SetupNarrowerInPossession"),
        [1951095402] = ("TeamWidth", "TeamWidthNone"),
        [1244744824] = ("TeamWidth", "SetupWiderInPossession"),
        [1347573861] = ("TeamWidth", "SetupMuchWiderInPossession"),
        [896626297] = ("PlayForSetPieces", "PlayForSetPieces"),
        [1869829494] = ("PlayForSetPieces", "PlayForSetPiecesNone"),
        [1968654134] = ("GoalkeeperUpForSetPieces", "GoalkeeperUpForAttackingSetPieces"),
        [1466265977] = ("GoalkeeperUpForSetPieces", "GoalkeeperUpForAttackingSetPiecesNone"),
        [1297429358] = ("CreativeFreedom", "BeMoreExpressive"),
        [1934574368] = ("CreativeFreedom", "CreativeFreedomNone"),
        [1752052821] = ("CreativeFreedom", "BeMoreDisciplined"),
        [1365857100] = ("BuildUpStrategy", "PlayThroughPress"),
        [1732331848] = ("BuildUpStrategy", "BuildUpStrategyNone"),
        [1702379875] = ("BuildUpStrategy", "BypassPress"),
        [1730167140] = ("GoalKicks", "GoalKicksShort"),
        [1248478788] = ("GoalKicks", "GoalKicksNone"),
        [1749839698] = ("GoalKicks", "GoalKicksLong"),
        [1936095309] = ("GoalkeeperDistributionSpeed", "GKDistributionPaceSlow"),
        [842232368] = ("GoalkeeperDistributionSpeed", "GKDistributionPaceNone"),
        [1380137303] = ("GoalkeeperDistributionSpeed", "GKDistributionPaceQuick"),
        [1398290509] = ("GoalkeeperDistributionTarget", "GKDistributionTargetNone"),
        [1097811032] = ("GoalkeeperDistributionTarget", "GKDistributionTargetCentrebacks"),
        [1732531317] = ("GoalkeeperDistributionTarget", "GKDistributionTargetFullbacks"),
        [2001361485] = ("GoalkeeperDistributionTarget", "GKDistributionTargetFlanks"),
        [543316536] = ("GoalkeeperDistributionTarget", "GKDistributionTargetPlaymaker"),
        [1362654530] = ("GoalkeeperDistributionTarget", "GKDistributionTargetTargetman"),
        [1664119088] = ("GoalkeeperDistributionTarget", "GKDistributionTargetClearOppositionDefence"),
        [1246451814] = ("Underlap", "LookForUnderlapLeft"),
        [894725200] = ("Underlap", "LookForUnderlapRight"),
        [1848850767] = ("Underlap", "LookForUnderlapBoth"),
        [1128871265] = ("Underlap", "LookForUnderlapNone"),
        [809924212] = ("Overlap", "LookForOverlapBoth"),
        [1496789296] = ("Overlap", "LookForOverlapLeft"),
        [1484157235] = ("Overlap", "LookForOverlapRight"),
        [1700947790] = ("Overlap", "LookForOverlapNone"),
        [1313559094] = ("Dribbling", "RunAtDefence"),
        [1480870768] = ("Dribbling", "DribblingNone"),
        [946684999] = ("Dribbling", "DribbleLess"),
        [2001548153] = ("ProgressThrough", "FocusPlayDownTheLeftFlank"),
        [1299723626] = ("ProgressThrough", "FocusPlayDownTheRightFlank"),
        [1465200750] = ("ProgressThrough", "FocusPlayDownTheMiddle"),
        [1849981002] = ("ProgressThrough", "FocusPlayDownBothFlanks"),
        [1800754547] = ("ProgressThrough", "ProgressThroughNone"),
        [1987666283] = ("PassReception", "PassingReceptionIntoSpace"),
        [1196126273] = ("PassReception", "PassReceptionNone"),
        [1817268034] = ("PassReception", "PassingReceptionIntoFeet"),
        [1196903216] = ("Patience", "WorkBallIntoBox"),
        [1364668513] = ("Patience", "PatienceNone"),
        [844190326] = ("Patience", "HitEarlyCrosses"),
        [1799907952] = ("ShotsFromDistance", "ShotsFromDistanceShootOnSight"),
        [1951290700] = ("ShotsFromDistance", "ShotsFromDistanceNone"),
        [2021157752] = ("ShotsFromDistance", "ShotsFromDistanceStayPatient"),
        [1817334343] = ("CrossingStyle", "CrossingNone"),
        [542589235] = ("CrossingStyle", "LowCrosses"),
        [1649964405] = ("CrossingStyle", "FloatCrosses"),
        [1850439286] = ("CrossingStyle", "WhippedCrosses"),
        [2033537859] = ("LineOfEngagement", "LineOfEngagementHigh"),
        [1196979288] = ("LineOfEngagement", "LineOfEngagementMid"),
        [927550517] = ("LineOfEngagement", "LineOfEngagementLow"),
        [1735747406] = ("DefensiveLine", "DefensiveLineMuchHigher"),
        [1329018200] = ("DefensiveLine", "DefensiveLineHigherDefensiveLine"),
        [894978671] = ("DefensiveLine", "DefensiveLineStandard"),
        [807423041] = ("DefensiveLine", "DefensiveLineDeeper"),
        [2003456321] = ("DefensiveLine", "DefensiveLineMuchDeeper"),
        [825575765] = ("DefensiveLineBehaviour", "HoldLine"),
        [1397124971] = ("DefensiveLineBehaviour", "DefensiveLineSecondaryStandard"),
        [1466132292] = ("DefensiveLineBehaviour", "DropOff"),
        [1500664391] = ("PressingTrigger", "PressingIntensityMuchLower"),
        [1985168495] = ("PressingTrigger", "PressingIntensityLower"),
        [1313689463] = ("PressingTrigger", "PressingIntensityNone"),
        [2000905329] = ("PressingTrigger", "PressingIntensityHigher"),
        [1450268022] = ("PressingTrigger", "PressingIntensityMuchHigher"),
        [928473934] = ("DefensiveTransition", "DefenceTransitionCounterpress"),
        [1396068403] = ("DefensiveTransition", "DefensiveTransitionNone"),
        [2001753209] = ("DefensiveTransition", "DefenceTransitionRegroup"),
        [1498428227] = ("Tackling", "GetStuckIn"),
        [1297249398] = ("Tackling", "TacklingNone"),
        [896480825] = ("Tackling", "StayOnFeet"),
        [1748587383] = ("PreventShortGKDistribution", "PreventShortGKDistribution"),
        [1667524405] = ("PreventShortGKDistribution", "PreventShortGKDistributionNone"),
        [1870092139] = ("PressingTrap", "PressingTrapIn"),
        [844782149] = ("PressingTrap", "PressingTrapNone"),
        [1381658469] = ("PressingTrap", "PressingTrapOut"),
        [1684615797] = ("CrossEngagement", "CrossStop"),
        [1097682775] = ("CrossEngagement", "CrossEngagementNone"),
        [1280010857] = ("CrossEngagement", "CrossInvite"),
    };

    public static bool IsOptionId(uint value) => HighHalves[value >> 16] && Options.ContainsKey(value);

    // Quick reject: most heap words never match the high 16 bits of any option id.
    private static readonly bool[] HighHalves = BuildHighHalves();

    private readonly string _logPath;
    private readonly object _gate = new();
    private nint _match;
    private int _firstTick = -1;
    private int _scansDone;
    private Thread? _worker;
    private StreamWriter? _log;

    public TacticSignatureScan(string logPath)
    {
        _logPath = logPath;
    }

    public string LogPath => _logPath;

    /// <summary>Called on the tick-drain thread; starts a background scan at the scheduled minutes.</summary>
    public void Observe(GameMatchTickRecord record, Func<IReadOnlyList<KnownObject>> knownObjects)
    {
        lock (_gate)
        {
            if (record.MatchAddress != _match || (_firstTick >= 0 && record.Tick < _firstTick))
            {
                _match = record.MatchAddress;
                _firstTick = record.Tick;
                _scansDone = 0;
            }

            if (_scansDone >= ScanMinutes.Length || _worker is { IsAlive: true }) return;
            var minute = Math.Max(0, record.DisplayTick) / 240;
            if (minute < ScanMinutes[_scansDone]) return;

            var scanNumber = ++_scansDone;
            var known = knownObjects().ToArray();
            var label = $"varrimento {scanNumber} (minuto {minute}, tick {record.Tick})";
            _worker = new Thread(() => RunScan(label, known))
            {
                IsBackground = true,
                Priority = ThreadPriority.BelowNormal,
                Name = "FMMatchLens tactic scan"
            };
            _worker.Start();
        }
    }

    private void RunScan(string label, KnownObject[] known)
    {
        var stopwatch = Stopwatch.StartNew();
        try
        {
            Write("");
            Write($"=== {label} — {DateTime.Now:HH:mm:ss}");
            foreach (var item in known) Write($"    conhecido: {item.Label} = {Hex(item.Address)} (+0x{item.Size:X})");

            var regions = EnumerateRegions();
            var totalBytes = regions.Sum(region => (long)region.Size);
            Write($"Regiões privadas de leitura/escrita: {regions.Count}, {totalBytes / (1024 * 1024)} MB.");

            var hits = FindOptionIds(regions);
            Write($"Ocorrências de IDs de opções: {hits.Count}{(hits.Count >= MaxHits ? " (limite atingido)" : "")} em {stopwatch.Elapsed.TotalSeconds:0.0} s.");

            var clusters = GroupIntoClusters(hits)
                .Where(cluster => cluster.Categories >= MinCategories)
                .OrderByDescending(cluster => cluster.Categories)
                .ThenBy(cluster => cluster.Start)
                .Take(MaxReportedClusters)
                .ToList();
            Write($"Blocos com opções de ≥ {MinCategories} instruções diferentes: {clusters.Count}.");

            FindHolders(regions, clusters, known);

            foreach (var (cluster, index) in clusters.Select((cluster, index) => (cluster, index + 1)))
            {
                Write("");
                Write($"--- Bloco {index}: {Hex((nint)cluster.Start)} … {Hex((nint)cluster.End)} " +
                      $"({cluster.End - cluster.Start + 4} bytes, {cluster.Categories} instruções, {cluster.Hits.Count} IDs)");
                foreach (var hit in cluster.Hits)
                {
                    var (category, option) = Options[hit.Value];
                    Write($"    +0x{hit.Address - cluster.Start:X4}  {category,-28} {option}");
                }

                Write(cluster.Holders.Count == 0
                    ? "    Ponteiros para este bloco: nenhum encontrado."
                    : $"    Ponteiros para este bloco ({cluster.Holders.Count}{(cluster.Holders.Count >= MaxHoldersPerCluster ? "+" : "")}):");
                foreach (var holder in cluster.Holders)
                {
                    Write($"      {Hex((nint)holder.Address)}{holder.KnownAs} → bloco{(holder.Target >= cluster.Start ? "+" : "-")}0x{Math.Abs((long)holder.Target - (long)cluster.Start):X}");
                }

                var dumpStart = cluster.Start - DumpMargin;
                var dump = Read(dumpStart, (int)(cluster.End - cluster.Start) + 4 + DumpMargin * 2);
                if (dump is not null)
                {
                    Write("    Bytes (início do bloco − 0x100):");
                    for (var offset = 0; offset < dump.Length; offset += 16)
                    {
                        var length = Math.Min(16, dump.Length - offset);
                        Write($"      {(long)offset - DumpMargin:+0x000;-0x000}  {Convert.ToHexString(dump, offset, length)}");
                    }
                }
            }

            Write($"=== fim do {label}: {stopwatch.Elapsed.TotalSeconds:0.0} s.");
        }
        catch (Exception ex)
        {
            Write($"Varrimento falhou: {ex}");
        }
    }

    private List<Hit> FindOptionIds(List<MemoryRegion> regions)
    {
        var hits = new List<Hit>();
        var buffer = new byte[ChunkBytes];
        foreach (var region in regions)
        {
            for (ulong offset = 0; offset < region.Size; offset += ChunkBytes)
            {
                var length = (int)Math.Min(ChunkBytes, region.Size - offset);
                var address = region.Start + offset;
                if (!ReadInto(address, buffer, length)) continue;
                var words = MemoryMarshal.Cast<byte, uint>(buffer.AsSpan(0, length & ~3));
                for (var index = 0; index < words.Length; index++)
                {
                    var value = words[index];
                    if (!HighHalves[value >> 16] || !Options.ContainsKey(value)) continue;
                    hits.Add(new Hit(address + (ulong)index * 4, value));
                    if (hits.Count >= MaxHits) return hits;
                }
            }
        }

        return hits;
    }

    private static List<Cluster> GroupIntoClusters(List<Hit> hits)
    {
        var clusters = new List<Cluster>();
        Cluster? current = null;
        foreach (var hit in hits)
        {
            if (current is null || hit.Address - current.End > ClusterGap)
            {
                current = new Cluster(hit.Address);
                clusters.Add(current);
            }

            current.Hits.Add(hit);
            current.End = hit.Address;
        }

        foreach (var cluster in clusters)
        {
            cluster.Categories = cluster.Hits.Select(hit => Options[hit.Value].Category).Distinct().Count();
        }

        return clusters;
    }

    /// <summary>Second pass: every aligned qword pointing into (or just before) a reported cluster.</summary>
    private void FindHolders(List<MemoryRegion> regions, List<Cluster> clusters, KnownObject[] known)
    {
        if (clusters.Count == 0) return;
        var ranges = clusters
            .Select(cluster => (Low: cluster.Start - 0x1000, High: cluster.End + 8, Cluster: cluster))
            .OrderBy(range => range.Low)
            .ToArray();
        var min = ranges.Min(range => range.Low);
        var max = ranges.Max(range => range.High);
        var buffer = new byte[ChunkBytes];
        foreach (var region in regions)
        {
            for (ulong offset = 0; offset < region.Size; offset += ChunkBytes)
            {
                var length = (int)Math.Min(ChunkBytes, region.Size - offset);
                var address = region.Start + offset;
                if (!ReadInto(address, buffer, length)) continue;
                var words = MemoryMarshal.Cast<byte, ulong>(buffer.AsSpan(0, length & ~7));
                for (var index = 0; index < words.Length; index++)
                {
                    var value = words[index];
                    if (value < min || value > max) continue;
                    foreach (var range in ranges)
                    {
                        if (value < range.Low || value > range.High) continue;
                        if (range.Cluster.Holders.Count >= MaxHoldersPerCluster) break;
                        var holderAddress = address + (ulong)index * 8;
                        range.Cluster.Holders.Add(new Holder(holderAddress, value, Describe(holderAddress, known)));
                        break;
                    }
                }
            }
        }
    }

    private static string Describe(ulong address, KnownObject[] known)
    {
        foreach (var item in known)
        {
            var start = (ulong)item.Address;
            if (address >= start && address < start + (ulong)item.Size)
            {
                return $" = {item.Label}+0x{address - start:X}";
            }
        }

        return "";
    }

    private static List<MemoryRegion> EnumerateRegions()
    {
        var regions = new List<MemoryRegion>();
        ulong address = 0x10000;
        var infoSize = (nuint)Marshal.SizeOf<MemoryBasicInformation>();
        while (address < 0x7FFF_FFFF_0000)
        {
            if (VirtualQuery((nint)address, out var info, infoSize) == 0) break;
            var start = (ulong)info.BaseAddress;
            var size = (ulong)info.RegionSize;
            if (size == 0) break;
            var protect = info.Protect & 0xFF;
            var writable = protect is 0x04 or 0x08 or 0x40 or 0x80;
            if (info.State == MemCommit && info.Type == MemPrivate && writable && (info.Protect & PageGuard) == 0)
            {
                regions.Add(new MemoryRegion(start, size));
            }

            address = start + size;
        }

        return regions;
    }

    private static byte[]? Read(ulong address, int length)
    {
        var buffer = new byte[length];
        return ReadInto(address, buffer, length) ? buffer : null;
    }

    private static bool ReadInto(ulong address, byte[] buffer, int length) =>
        ReadProcessMemory(GetCurrentProcess(), (nint)address, buffer, (nuint)length, out var read) && (int)read == length;

    private static bool[] BuildHighHalves()
    {
        var halves = new bool[65536];
        foreach (var value in Options.Keys) halves[value >> 16] = true;
        return halves;
    }

    private static string Hex(nint value) => "0x" + ((ulong)value).ToString("X", CultureInfo.InvariantCulture);

    private void Write(string line)
    {
        lock (_gate)
        {
            if (_log is null)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);
                var stream = new FileStream(_logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                _log = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
            }

            _log.WriteLine(line);
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _log?.Dispose();
            _log = null;
        }
    }

    private const uint MemCommit = 0x1000;
    private const uint MemPrivate = 0x20000;
    private const uint PageGuard = 0x100;

    [DllImport("kernel32.dll")]
    private static extern nuint VirtualQuery(nint lpAddress, out MemoryBasicInformation lpBuffer, nuint dwLength);

    [DllImport("kernel32.dll")]
    private static extern nint GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(nint process, nint baseAddress, [Out] byte[] buffer, nuint size, out nuint read);

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryBasicInformation
    {
        public nint BaseAddress;
        public nint AllocationBase;
        public uint AllocationProtect;
        public ushort PartitionId;
        public nuint RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    private readonly record struct MemoryRegion(ulong Start, ulong Size);

    private readonly record struct Hit(ulong Address, uint Value);

    private readonly record struct Holder(ulong Address, ulong Target, string KnownAs);

    private sealed class Cluster
    {
        public Cluster(ulong start)
        {
            Start = start;
            End = start;
        }

        public ulong Start { get; }
        public ulong End { get; set; }
        public int Categories { get; set; }
        public List<Hit> Hits { get; } = new();
        public List<Holder> Holders { get; } = new();
    }
}

/// <summary>A structure the plugin already knows, used to name pointer holders.</summary>
internal readonly record struct KnownObject(string Label, nint Address, int Size);
