using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// Research-only probe (config <c>Research.TacticProbe</c>, off by default) used to locate the
/// live tactic in memory. Version 3.
///
/// Once per second it snapshots raw bytes of the match, the probed team and the objects around
/// it (manager, TEAM@db, TeamBase, plain data blocks behind its pointers), every MatchPlayer's
/// tactical block, and the contents of every std::vector-like list (begin/end/capacity triple)
/// found in the team and player blocks. It diffs them as 8-byte words and logs every change.
///
/// Nothing is filtered by pauses (session 2 showed short pauses go unnoticed). A word is only
/// silenced when it behaves like live game state: it changed during the two-minute calibration,
/// or three times within ten seconds. Pauses are still marked in the log for orientation; the
/// mapping to the user's script is done offline with the real-time timestamps they note.
///
/// At kick-off it also writes a per-player snapshot (position-word flags and list contents) so
/// the known starting instructions can be compared with the raw bytes.
///
/// It never writes to game memory and only runs on the tick-drain thread, never on the hook.
/// </summary>
internal sealed class TacticProbe : IDisposable
{
    private const int MatchRegionSize = 0x15600;
    private const int TeamRegionSize = 0x3000;
    private const int SideObjectRegionSize = 0x1000;
    private const int PlayerRegionStart = 0xD00;
    private const int PlayerRegionEnd = 0xF00;
    private const int ObjectRegionSize = 0x800;
    private const int PointeeRegionSize = 0x400;
    private const int MaxPointeeRegions = 96;
    private const int MaxListBytes = 0x800;
    private const int MaxListRegions = 160;
    private const int ReadChunk = 0x200;
    private const int CalibrationTicks = 2 * 240;
    // A word is game state when it changes 3× within 10 s or 6× within 2 min. Tactic edits in the
    // script come at most every ~25 s, so a tactic word stays under both limits.
    private const int BurstLimit = 3;
    private static readonly long BurstWindow = Stopwatch.Frequency * 10;
    private const int SlowBurstLimit = 6;
    private static readonly long SlowBurstWindow = Stopwatch.Frequency * 120;
    private static readonly long PauseThreshold = Stopwatch.Frequency * 3 / 2;
    // A recomputation can touch thousands of words at once; keep those snapshots readable.
    private const int MaxLinesPerRegionSnapshot = 48;
    private const int MaxRttiCacheEntries = 100_000;
    private const int MaxScannedObjects = 600;

    private static readonly string[] InterestingClassFragments =
    {
        "TACTIC", "INSTRUCT", "MENTALIT", "FORMATION", "SHOUT", "ORDER", "STYLE"
    };

    // Player blocks: the position words whose high u32 carries per-position flags (session 2).
    private static readonly (string Name, int Offset)[] PositionWords =
    {
        ("cópia1 com bola", 0xD28), ("cópia2 com bola", 0xD70), ("sem bola", 0xE00)
    };

    private readonly MemoryReader _reader = new();
    private readonly string _logPath;
    private readonly Dictionary<nint, string?> _rttiNames = new();
    private readonly Dictionary<string, Region> _regions = new(StringComparer.Ordinal);
    private readonly HashSet<nint> _objectAddresses = new();
    private readonly HashSet<nint> _scannedObjects = new();
    private StreamWriter? _log;
    private nint _match;
    private (nint Home, nint Away) _probedTeams;
    private int _firstTick = -1;
    private int _lastTick;
    private bool _calibrationReported;
    private bool _kickoffSnapshotWritten;
    private long _lastObservedTimestamp;
    private long _tickLastAdvancedTimestamp;
    private bool _paused;
    private int _pauseIndex;

    public TacticProbe(string logPath)
    {
        _logPath = logPath;
    }

    public string LogPath => _logPath;

    /// <summary>Snapshots and diffs the probed memory; throttled to once per second.</summary>
    public void Observe(
        GameMatchTickRecord record,
        Func<nint, bool> isHumanTeam,
        Func<nint, string?> playerName)
    {
        var now = Stopwatch.GetTimestamp();
        if (_lastObservedTimestamp != 0 && now - _lastObservedTimestamp < Stopwatch.Frequency) return;
        _lastObservedTimestamp = now;

        using var scope = VirtualMemory.BeginReadScope();
        // Native GAME_MATCH storage is reused between matches, so a tick that jumps back by more
        // than a minute also means a new match at the same address.
        if (record.MatchAddress != _match || record.Tick < _lastTick - 240)
        {
            StartMatch(record, isHumanTeam);
            _tickLastAdvancedTimestamp = now;
        }

        TrackPause(record, now);
        _lastTick = record.Tick;

        var calibrating = _firstTick >= 0 && record.Tick - _firstTick < CalibrationTicks;
        if (!calibrating && !_calibrationReported && _firstTick >= 0)
        {
            ReportCalibration(record);
        }

        RefreshPlayerRegions(playerName);
        RefreshListRegions(record);
        RefreshPointeeRegions();

        if (!_kickoffSnapshotWritten)
        {
            _kickoffSnapshotWritten = true;
            WriteKickoffSnapshot(playerName);
        }

        foreach (var region in _regions.Values.ToList())
        {
            Diff(region, record, calibrating, now);
        }
    }

    private void TrackPause(GameMatchTickRecord record, long now)
    {
        if (record.Tick != _lastTick)
        {
            if (_paused)
            {
                _paused = false;
                var seconds = (now - _tickLastAdvancedTimestamp) / (double)Stopwatch.Frequency;
                Write($"[{Clock(record)}] ▶ retoma #{_pauseIndex} (parado ~{seconds:0} s)");
            }

            _tickLastAdvancedTimestamp = now;
            return;
        }

        if (!_paused && now - _tickLastAdvancedTimestamp >= PauseThreshold)
        {
            _paused = true;
            _pauseIndex++;
            Write($"[{Clock(record)}] ⏸ parado #{_pauseIndex}");
        }
    }

    private void StartMatch(GameMatchTickRecord record, Func<nint, bool> isHumanTeam)
    {
        _match = record.MatchAddress;
        _firstTick = record.Tick;
        _lastTick = record.Tick;
        _calibrationReported = false;
        _kickoffSnapshotWritten = false;
        _paused = false;
        _pauseIndex = 0;
        _regions.Clear();
        _objectAddresses.Clear();
        _scannedObjects.Clear();

        Write("");
        Write($"=== Novo jogo (sonda v3): GameMatch {Hex(record.MatchAddress)}, tick {record.Tick}, " +
              $"casa {Hex(record.HomeTeam)} ({record.HomePlayerCount} jog.), fora {Hex(record.AwayTeam)} ({record.AwayPlayerCount} jog.)");

        var homeHuman = isHumanTeam(record.HomeTeam);
        var awayHuman = isHumanTeam(record.AwayTeam);
        var probeHome = homeHuman || !awayHuman;
        var probeAway = awayHuman || !homeHuman;
        _probedTeams = (probeHome ? record.HomeTeam : default, probeAway ? record.AwayTeam : default);
        Write($"Equipas sondadas: {(probeHome ? "casa" : "")}{(probeHome && probeAway ? " + " : "")}{(probeAway ? "fora" : "")} " +
              $"(humano: casa={homeHuman}, fora={awayHuman})");
        Write($"Calibração: nos primeiros {CalibrationTicks / 240} minutos de jogo NÃO mexas na tática nem pauses.");
        Write("Formato: [hora real · minuto de jogo · tick] região +offset  antigo → novo  xor  bytes. " +
              "Anota a hora real de cada passo do guião.");

        AddRegion("GameMatch", record.MatchAddress, 0, MatchRegionSize);
        ScanAndSummarise("GameMatch", record.MatchAddress, MatchRegionSize);
        foreach (var (label, team) in TeamsToProbe())
        {
            AddRegion(label, team, 0, TeamRegionSize);
            ScanAndSummarise(label, team, TeamRegionSize);
            AddPointedRegion($"{label} treinador", team, Offsets.Team.Manager, SideObjectRegionSize);
            AddPointedRegion($"{label} TEAM@db", team, Offsets.Team.DbTeam, SideObjectRegionSize);
            AddPointedRegion($"{label} TeamBase", team, Offsets.Team.TeamBase, SideObjectRegionSize);
        }
    }

    private IEnumerable<(string Label, nint Team)> TeamsToProbe()
    {
        if (_probedTeams.Home != default) yield return ("Team[casa]", _probedTeams.Home);
        if (_probedTeams.Away != default) yield return ("Team[fora]", _probedTeams.Away);
    }

    private void AddPointedRegion(string label, nint owner, int offset, int size)
    {
        if (_reader.TryReadPointer(owner + offset, out var target) && LooksLikePointer(target))
        {
            AddRegion(label, target, 0, size);
            Write($"    {label}: {Hex(target)}{(RttiName(target) is { } name ? $" ({name})" : "")}");
        }
    }

    private void ScanAndSummarise(string label, nint address, int size)
    {
        var classes = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        ScanPointers(label, address, size, depth: 2, classes);
        Write($"--- Classes RTTI apontadas a partir de {label}:");
        foreach (var (name, paths) in classes.OrderByDescending(pair => pair.Value.Count))
        {
            var where = string.Join(", ", paths.Take(4)) + (paths.Count > 4 ? ", …" : "");
            Write($"    {paths.Count,4}× {name}{(IsInteresting(name) ? "   ◀ candidato" : "")}  ({where})");
        }
    }

    private void ReportCalibration(GameMatchTickRecord record)
    {
        _calibrationReported = true;
        var noisy = _regions.Values.Sum(region => region.Noisy.Count);
        Write($"[{Clock(record)}] Calibração terminada ({noisy} palavras marcadas como estado do jogo). " +
              "Começa o guião e anota a hora real de cada passo.");
    }

    /// <summary>Per-player flags and list contents at kick-off, to compare with known instructions.</summary>
    private void WriteKickoffSnapshot(Func<nint, string?> playerName)
    {
        Write("--- Fotografia inicial dos jogadores (flags = u32 alto das palavras de posição):");
        foreach (var (key, region) in _regions
                     .Where(pair => pair.Value.ListOwnerKey is null && pair.Key.StartsWith("Jogador ", StringComparison.Ordinal))
                     .OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            var flags = string.Join("  ", PositionWords.Select(word =>
                _reader.TryReadUInt64(region.Address + word.Offset, out var value)
                    ? $"{word.Name}=0x{value >> 32:X8}"
                    : $"{word.Name}=?"));
            Write($"    {region.Label}: {flags}");
            foreach (var list in _regions.Values.Where(candidate => candidate.ListOwnerKey == key))
            {
                var bytes = ReadBlock(list.Address, list.Size, out var readable);
                Write($"      {list.Label}: {list.Size} bytes{(readable ? "" : " (ilegível)")}");
                if (readable) WriteHexDump(bytes, "        ");
            }
        }
    }

    private void WriteHexDump(byte[] bytes, string indent)
    {
        for (var offset = 0; offset < bytes.Length; offset += 16)
        {
            var length = Math.Min(16, bytes.Length - offset);
            Write($"{indent}+0x{offset:X3}  {Convert.ToHexString(bytes, offset, length)}");
        }
    }

    private void RefreshPlayerRegions(Func<nint, string?> playerName)
    {
        RefreshTeamPlayers("casa", _probedTeams.Home, playerName);
        RefreshTeamPlayers("fora", _probedTeams.Away, playerName);
    }

    private void RefreshTeamPlayers(string side, nint team, Func<nint, string?> playerName)
    {
        if (team == default) return;
        // The player table holds up to 23 entries (starters + bench).
        for (var slot = 0; slot < 23; slot++)
        {
            if (!_reader.TryReadPointer(team + Offsets.Team.PlayerTable + slot * IntPtr.Size, out var player) ||
                player == default || RttiName(player) is not { } name || !name.StartsWith("MATCH_PLAYER", StringComparison.Ordinal))
            {
                continue;
            }

            var key = $"Jogador {side} slot {slot:00}";
            if (_regions.TryGetValue(key, out var existing) && existing.Address == player) continue;
            var label = $"{key} {ReadPosition(player)} {playerName(player) ?? "?"}";
            _regions[key] = new Region(label, player, PlayerRegionStart, PlayerRegionEnd - PlayerRegionStart);
        }
    }

    /// <summary>
    /// Finds begin/end/capacity pointer triples (std::vector layout) inside the team and player
    /// blocks and observes the bytes between begin and end. When a list is reallocated or
    /// resized, its whole new content is written out once and the diff baseline restarts.
    /// </summary>
    private void RefreshListRegions(GameMatchTickRecord record)
    {
        var owners = _regions
            .Where(pair => pair.Value.ListOwnerKey is null &&
                           (pair.Key.StartsWith("Jogador ", StringComparison.Ordinal) ||
                            pair.Key is "Team[casa]" or "Team[fora]"))
            .ToList();
        foreach (var (ownerKey, owner) in owners)
        {
            for (var offset = owner.Start; offset + 24 <= owner.Start + owner.Size; offset += 8)
            {
                if (!_reader.TryReadPointer(owner.Address + offset, out var begin) ||
                    !_reader.TryReadPointer(owner.Address + offset + 8, out var end) ||
                    !_reader.TryReadPointer(owner.Address + offset + 16, out var capacity) ||
                    !LooksLikePointer(begin) || end < begin || capacity < end ||
                    end - begin > MaxListBytes || capacity - begin > MaxListBytes * 4 ||
                    // Consecutive object pointers (e.g. the player table) are not list data.
                    (end > begin && RttiName(begin) is not null))
                {
                    continue;
                }

                var key = $"{ownerKey} lista+0x{offset:X}";
                var size = (int)(end - begin);
                if (_regions.TryGetValue(key, out var existing))
                {
                    if (existing.Address == begin && existing.Size == size) continue;
                    var replacement = new Region(existing.Label, begin, 0, size) { ListOwnerKey = ownerKey };
                    _regions[key] = replacement;
                    if (_calibrationReported)
                    {
                        Write($"[{Clock(record)}] {existing.Label}: realocada/redimensionada {existing.Size} → {size} bytes. Conteúdo novo:");
                        var bytes = ReadBlock(begin, size, out var readable);
                        if (readable) WriteHexDump(bytes, "        ");
                    }
                    continue;
                }

                if (_regions.Values.Count(region => region.ListOwnerKey is not null) >= MaxListRegions) continue;
                var ownerLabel = owner.Label.Length > 48 ? owner.Label[..48] : owner.Label;
                _regions[key] = new Region($"{ownerLabel} lista+0x{offset:X}", begin, 0, size) { ListOwnerKey = ownerKey };
            }
        }
    }

    /// <summary>Plain data (no RTTI) behind single pointers stored in the team structure.</summary>
    private void RefreshPointeeRegions()
    {
        foreach (var (label, team) in TeamsToProbe())
        {
            nint previousTarget = default;
            for (var offset = 0x300; offset + IntPtr.Size <= TeamRegionSize; offset += IntPtr.Size)
            {
                var key = $"{label}+0x{offset:X}→";
                if (!_reader.TryReadPointer(team + offset, out var target) ||
                    !LooksLikePointer(target) ||
                    target == previousTarget ||
                    target == team || target == _match ||
                    !VirtualMemory.IsReadable(target, 8) ||
                    RttiName(target) is not null)
                {
                    previousTarget = target;
                    continue;
                }

                previousTarget = target;
                if (_regions.TryGetValue(key, out var existing))
                {
                    if (existing.Address != target) _regions[key] = existing.MovedTo(target);
                    continue;
                }

                if (_regions.Count(pair => pair.Key.EndsWith("→", StringComparison.Ordinal)) >= MaxPointeeRegions) continue;
                _regions[key] = new Region(key, target, 0, PointeeRegionSize);
            }
        }
    }

    private string ReadPosition(nint player)
    {
        if (_reader.TryReadUInt32(player + Offsets.MatchPlayer.InPossessionPosition, out var mask) &&
            _reader.TryReadUInt64(player + Offsets.MatchPlayer.InPossessionRoleDuty, out var roleDuty))
        {
            var assignment = TacticalFormationDecoder.Decode(mask, roleDuty, inPossession: true);
            if (assignment is { } value) return $"{value.Position}/{value.RoleAbbreviation}";
        }

        return "?";
    }

    private void AddRegion(string label, nint address, int start, int size)
    {
        _regions[label] = new Region(label, address, start, size);
    }

    private void ScanPointers(string label, nint baseAddress, int size, int depth, Dictionary<string, List<string>> classes)
    {
        for (var offset = 0; offset + IntPtr.Size <= size; offset += IntPtr.Size)
        {
            if (!_reader.TryReadPointer(baseAddress + offset, out var target) || !LooksLikePointer(target)) continue;
            var name = RttiName(target);
            if (name is null) continue;

            var interesting = IsInteresting(name);
            var path = $"{label}+0x{offset:X}";
            if (depth == 2 || interesting)
            {
                if (!classes.TryGetValue(name, out var paths)) classes[name] = paths = new List<string>();
                paths.Add(path);
            }

            if (interesting && _objectAddresses.Add(target))
            {
                AddRegion($"obj {name} ({path})", target, 0, ObjectRegionSize);
            }

            if (depth > 1 && _scannedObjects.Count < MaxScannedObjects && _scannedObjects.Add(target))
            {
                ScanPointers(path, target, ObjectRegionSize, depth - 1, classes);
            }
        }
    }

    private static bool IsInteresting(string name)
    {
        var upper = name.ToUpperInvariant();
        return InterestingClassFragments.Any(fragment => upper.Contains(fragment, StringComparison.Ordinal));
    }

    private static bool LooksLikePointer(nint value) =>
        value != default && (ulong)value >= 0x10000 && (ulong)value < 0x7FFF_FFFF_FFFF && (value & 7) == 0;

    /// <summary>
    /// MSVC x64 RTTI: vtable[-1] is the CompleteObjectLocator (signature 1), whose +0x0C and +0x14
    /// fields are image-relative RVAs of the TypeDescriptor and of the locator itself. The mangled
    /// class name (".?AVNAME@@") sits at TypeDescriptor+0x10.
    /// </summary>
    private string? RttiName(nint objectAddress)
    {
        if (!_reader.TryReadPointer(objectAddress, out var vtable) || !LooksLikePointer(vtable)) return null;
        if (_rttiNames.TryGetValue(vtable, out var cached)) return cached;

        string? name = null;
        if (_reader.TryReadPointer(vtable - IntPtr.Size, out var locator) &&
            LooksLikePointer(locator) &&
            _reader.TryReadUInt32(locator, out var signature) && signature == 1 &&
            _reader.TryReadUInt32(locator + 0x0C, out var typeDescriptorRva) &&
            _reader.TryReadUInt32(locator + 0x14, out var selfRva) &&
            selfRva != 0)
        {
            var imageBase = locator - (nint)selfRva;
            var mangled = ReadAscii(imageBase + (nint)typeDescriptorRva + 0x10, 256);
            if (mangled is not null && mangled.StartsWith(".?A", StringComparison.Ordinal) && mangled.EndsWith("@@", StringComparison.Ordinal))
            {
                name = mangled[4..^2];
            }
        }

        if (_rttiNames.Count < MaxRttiCacheEntries) _rttiNames[vtable] = name;
        return name;
    }

    private string? ReadAscii(nint address, int maxLength)
    {
        var builder = new StringBuilder();
        for (var index = 0; index < maxLength; index++)
        {
            if (!_reader.TryReadByte(address + index, out var value)) return null;
            if (value == 0) return builder.ToString();
            if (value < 0x20 || value > 0x7E) return null;
            builder.Append((char)value);
        }

        return null;
    }

    private void Diff(Region region, GameMatchTickRecord record, bool calibrating, long now)
    {
        if (region.Size <= 0) return;
        var current = ReadBlock(region.Address + region.Start, region.Size, out var readable);
        if (!readable) return;

        var previous = region.Previous;
        region.Previous = current;
        if (previous is null || previous.Length != current.Length) return;

        var lines = 0;
        var suppressed = 0;
        for (var word = 0; word + 8 <= current.Length; word += 8)
        {
            var oldValue = BitConverter.ToUInt64(previous, word);
            var newValue = BitConverter.ToUInt64(current, word);
            if (oldValue == newValue) continue;

            var offset = region.Start + word;
            if (region.Noisy.Contains(offset)) continue;
            if (calibrating)
            {
                region.Noisy.Add(offset);
                continue;
            }

            // Live game state changes in bursts; tactic edits arrive at most every ~20 s.
            if (!region.RecentChanges.TryGetValue(offset, out var recent))
            {
                region.RecentChanges[offset] = recent = new Queue<long>();
            }
            recent.Enqueue(now);
            while (recent.Count > SlowBurstLimit) recent.Dequeue();
            var lastThree = recent.Count >= BurstLimit ? recent.ElementAt(recent.Count - BurstLimit) : long.MaxValue;
            if ((recent.Count >= BurstLimit && now - lastThree <= BurstWindow) ||
                (recent.Count == SlowBurstLimit && now - recent.Peek() <= SlowBurstWindow))
            {
                region.Noisy.Add(offset);
                region.RecentChanges.Remove(offset);
                continue;
            }

            if (lines >= MaxLinesPerRegionSnapshot)
            {
                suppressed++;
                continue;
            }

            lines++;
            Write($"[{Clock(record)}] {region.Label} +0x{offset:X4}  " +
                  $"{oldValue:X16} → {newValue:X16}  xor {oldValue ^ newValue:X}  " +
                  $"bytes [{ChangedBytes(previous, current, word)}]");
        }

        if (suppressed > 0)
        {
            Write($"[{Clock(record)}] {region.Label}: mais {suppressed} palavras mudaram neste segundo (omitidas).");
        }
    }

    private static string ChangedBytes(byte[] previous, byte[] current, int word)
    {
        var parts = new List<string>();
        for (var index = 0; index < 8; index++)
        {
            if (previous[word + index] != current[word + index])
            {
                parts.Add($"+{index}: {previous[word + index]}→{current[word + index]}");
            }
        }

        return string.Join(", ", parts);
    }

    private static byte[] ReadBlock(nint address, int size, out bool readable)
    {
        var buffer = new byte[Math.Max(0, size)];
        readable = false;
        for (var offset = 0; offset < size; offset += ReadChunk)
        {
            var length = Math.Min(ReadChunk, size - offset);
            if (!VirtualMemory.IsReadable(address + offset, length)) continue;
            Marshal.Copy(address + offset, buffer, offset, length);
            readable = true;
        }

        return buffer;
    }

    private static string Clock(GameMatchTickRecord record)
    {
        var seconds = Math.Max(0, record.DisplayTick) / 4;
        return $"{DateTime.Now:HH:mm:ss} {seconds / 60:00}:{seconds % 60:00} tick {record.Tick}";
    }

    private static string Hex(nint value) => "0x" + ((ulong)value).ToString("X", CultureInfo.InvariantCulture);

    private void Write(string line)
    {
        if (_log is null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);
            var stream = new FileStream(_logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            _log = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
        }

        _log.WriteLine(line);
    }

    public void Dispose()
    {
        _log?.Dispose();
        _log = null;
    }

    private sealed class Region
    {
        public Region(string label, nint address, int start, int size)
        {
            Label = label;
            Address = address;
            Start = start;
            Size = size;
        }

        public string Label { get; }
        public nint Address { get; }
        public int Start { get; }
        public int Size { get; }
        public string? ListOwnerKey { get; init; }
        public byte[]? Previous { get; set; }
        public HashSet<int> Noisy { get; } = new();
        public Dictionary<int, Queue<long>> RecentChanges { get; } = new();

        /// <summary>Same pointer slot, new target: keep the noise map, restart the byte baseline.</summary>
        public Region MovedTo(nint address)
        {
            var moved = new Region(Label, address, Start, Size) { ListOwnerKey = ListOwnerKey };
            moved.Noisy.UnionWith(Noisy);
            return moved;
        }
    }
}
