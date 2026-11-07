using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// Research-only tool (config <c>Research.TacticPauseDiff</c>, off by default) that finds where the
/// selected tactic lives by comparing process memory snapshots taken while the match is paused.
/// Version 2.
///
/// A series per instruction, all while paused, Ctrl+F9 after each step:
///   base A → (nothing) base B → change 1 → change 2 → … → back to the start → Ctrl+F11.
/// Pages that differ between the two bases change on their own (UI rendering, animation flags)
/// and are excluded. Pages that changed between base B and the first change are tracked with a
/// full copy per snapshot. The analysis groups every changing byte by its value pattern across
/// the change snapshots (e.g. "ABACD"); the user's script contains a repeat, which counters
/// (never repeat) and toggling flags (only two values) cannot reproduce. For the best candidates
/// of the most specific patterns it then searches pointers two levels up and flags holders inside
/// game_plugin.dll's image — the stable roots.
///
/// Memory is read with ReadProcessMemory on our own process (fails cleanly on freed pages).
/// Runs on its own background thread; a beep marks the end of each step.
/// </summary>
internal sealed class TacticPauseDiff : IDisposable
{
    private const int PageSize = 4096;
    private const int ChunkBytes = 4 * 1024 * 1024;
    // ~650 MB for the first change snapshot; later snapshots keep only pages that keep changing.
    private const int MaxTrackedPages = 160_000;
    private const int MaxMatchesLogged = 400;

    /// <summary>
    /// Ordinal position of each value the script sets after the two bases, per series. Mentality uses
    /// the official 1–7 scale; five-level instructions 1–5; three-option ones 1–3 (Menos/Padrão/Mais).
    /// A tactic field must satisfy value = a·position + b for some a ≠ 0, in whatever scale it uses.
    /// </summary>
    private static readonly int[][] ScriptPositions =
    {
        new[] { 1, 7, 1, 4, 5 }, // 1 Mentalidade: Muito defensiva, Muito ofensiva, Muito defensiva, Equilibrada, Positiva
        new[] { 1, 5, 1, 3, 4 }, // 2 Ritmo: Muito mais lento, Muito mais rápido, Muito mais lento, Equilibrado, Mais rápido
        new[] { 1, 5, 1, 3, 4 }, // 3 Linha: Muito mais baixa, Muito mais alta, Muito mais baixa, Equilibrada, Mais alta
        new[] { 1, 3, 1, 2 },    // 4 Remates: Rematar Menos, Rematar Mais, Rematar Menos, Padrão
        new[] { 2, 1, 2, 1 },    // 5 Marcação: Mais em cima, Padrão, Mais em cima, Padrão
    };
    private const int MaxPatternsLogged = 40;
    private const int MaxCandidatesPerPattern = 40;
    private const int MaxCandidatesTraced = 8;
    private const int MaxHolders = 24;
    private const int HolderWindow = 0x4000;
    private const int VkF9 = 0x78;
    private const int VkF11 = 0x7A;
    private const int VkControl = 0x11;

    private readonly string _logPath;
    private readonly Func<IReadOnlyList<KnownObject>> _knownObjects;
    private readonly Thread _thread;
    private readonly object _logGate = new();
    private volatile bool _stopping;
    private StreamWriter? _log;

    // Current series.
    private int _seriesIndex;
    private int _snapshotIndex;
    private Dictionary<ulong, ulong>? _baseHashes;
    private HashSet<ulong>? _noisyPages;
    private List<ulong>? _trackedPages;
    private readonly List<Dictionary<ulong, byte[]>> _copies = new(); // one per change snapshot
    private readonly List<(int Series, string Kind, ulong Address)> _previousCandidates = new();

    public TacticPauseDiff(string logPath, Func<IReadOnlyList<KnownObject>> knownObjects)
    {
        _logPath = logPath;
        _knownObjects = knownObjects;
        _thread = new Thread(Run) { IsBackground = true, Priority = ThreadPriority.BelowNormal, Name = "FMMatchLens pause diff" };
        _thread.Start();
    }

    public string LogPath => _logPath;

    private void Run()
    {
        Write($"=== Comparação em pausa v2 pronta ({DateTime.Now:HH:mm:ss}). Ctrl+F9 = fotografia, Ctrl+F11 = analisar a série.");
        Write("    Cada série: base A → base B (sem mudar nada) → mudança → … → voltar ao início → Ctrl+F11.");
        var f9WasDown = false;
        var f11WasDown = false;
        while (!_stopping)
        {
            Thread.Sleep(50);
            // Ctrl is required so FM's own F-key shortcuts are not triggered by accident.
            var ctrl = (GetAsyncKeyState(VkControl) & 0x8000) != 0;
            var f9 = ctrl && (GetAsyncKeyState(VkF9) & 0x8000) != 0;
            var f11 = ctrl && (GetAsyncKeyState(VkF11) & 0x8000) != 0;
            try
            {
                if (f9 && !f9WasDown) TakeSnapshot();
                else if (f11 && !f11WasDown) AnalyseSeries();
            }
            catch (Exception ex)
            {
                Write($"Erro: {ex}");
                Beep(220, 400);
            }

            f9WasDown = f9;
            f11WasDown = f11;
        }
    }

    private void TakeSnapshot()
    {
        var stopwatch = Stopwatch.StartNew();
        _snapshotIndex++;
        switch (_snapshotIndex)
        {
            case 1:
                _seriesIndex++;
                _copies.Clear();
                _trackedPages = null;
                _noisyPages = null;
                _baseHashes = HashAllPages(out var bytes);
                Write("");
                Write($"=== Série {_seriesIndex}: base A às {DateTime.Now:HH:mm:ss} — {_baseHashes.Count} páginas, " +
                      $"{bytes / (1024 * 1024)} MB, {stopwatch.Elapsed.TotalSeconds:0.0} s. Agora Ctrl+F9 outra vez SEM mudar nada.");
                break;

            case 2:
            {
                var current = HashAllPages(out _);
                _noisyPages = current
                    .Where(pair => _baseHashes!.TryGetValue(pair.Key, out var old) && old != pair.Value)
                    .Select(pair => pair.Key)
                    .ToHashSet();
                _baseHashes = current;
                Write($"    Base B às {DateTime.Now:HH:mm:ss}: {_noisyPages.Count} páginas mudam sozinhas (excluídas), " +
                      $"{stopwatch.Elapsed.TotalSeconds:0.0} s. Faz a 1.ª mudança e Ctrl+F9.");
                break;
            }

            case 3:
            {
                var current = HashAllPages(out _);
                var changed = current
                    .Where(pair => _baseHashes!.TryGetValue(pair.Key, out var old) && old != pair.Value)
                    .Select(pair => pair.Key)
                    .ToList();
                _baseHashes = null;
                // Quiet pages first; noisy pages that also changed still get tracked if room is left,
                // because the tactic may share a page with a field that changes on its own. Byte-level
                // noise is removed later by the value patterns.
                var quiet = changed.Where(page => !_noisyPages!.Contains(page)).ToList();
                var noisy = changed.Where(page => _noisyPages!.Contains(page)).ToList();
                _trackedPages = quiet.Concat(noisy).Take(MaxTrackedPages).ToList();
                _copies.Add(CopyTrackedPages());
                Write($"    Mudança 1 às {DateTime.Now:HH:mm:ss}: {quiet.Count} páginas mudaram só agora + {noisy.Count} ruidosas; " +
                      $"seguidas {_trackedPages.Count}{(quiet.Count > MaxTrackedPages ? " (LIMITE: nem todas as páginas limpas cabem)" : "")}, " +
                      $"{stopwatch.Elapsed.TotalSeconds:0.0} s.");
                break;
            }

            default:
            {
                // Every step of the script changes the value, so a page that did not change since the
                // previous snapshot cannot hold it: drop it from every copy to keep memory bounded.
                var copy = CopyTrackedPages();
                var previous = _copies[^1];
                var before = _trackedPages!.Count;
                _trackedPages = _trackedPages
                    .Where(page => copy.TryGetValue(page, out var now) &&
                                   previous.TryGetValue(page, out var then) &&
                                   !now.AsSpan().SequenceEqual(then))
                    .ToList();
                var keep = _trackedPages.ToHashSet();
                foreach (var old in _copies)
                {
                    foreach (var page in old.Keys.Where(page => !keep.Contains(page)).ToList()) old.Remove(page);
                }

                foreach (var page in copy.Keys.Where(page => !keep.Contains(page)).ToList()) copy.Remove(page);
                _copies.Add(copy);
                Write($"    Mudança {_snapshotIndex - 2} às {DateTime.Now:HH:mm:ss}: {_trackedPages.Count} de {before} páginas " +
                      $"voltaram a mudar, {stopwatch.Elapsed.TotalSeconds:0.0} s.");
                break;
            }
        }

        Beep(880, 120);
    }

    private Dictionary<ulong, byte[]> CopyTrackedPages()
    {
        var copies = new Dictionary<ulong, byte[]>(_trackedPages!.Count);
        foreach (var page in _trackedPages!)
        {
            var content = Read(page, PageSize);
            if (content is not null) copies[page] = content;
        }

        return copies;
    }

    private void AnalyseSeries()
    {
        if (_copies.Count < 3)
        {
            Write($"Ctrl+F11 ignorado: a série {_seriesIndex} só tem {_copies.Count} mudanças (mínimo 3, com uma repetição).");
            Beep(330, 300);
            return;
        }

        var stopwatch = Stopwatch.StartNew();
        var steps = _copies.Count;
        if (_seriesIndex < 1 || _seriesIndex > ScriptPositions.Length || ScriptPositions[_seriesIndex - 1].Length != steps)
        {
            Write($"--- Série {_seriesIndex}: {steps} mudanças não correspondem ao guião " +
                  $"({(_seriesIndex <= ScriptPositions.Length ? ScriptPositions[_seriesIndex - 1].Length : 0)} esperadas). " +
                  "Reinicia o jogo para recomeçar na série 1, ou repete a série com o número certo de passos.");
            ResetSeries();
            Beep(330, 300);
            return;
        }

        var positions = ScriptPositions[_seriesIndex - 1];
        var matches = new List<Match>();
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var bytes = new long[steps];
        var signedBytes = new long[steps];
        var words16 = new long[steps];
        var words32 = new long[steps];
        var floats = new double[steps];
        foreach (var page in _trackedPages!)
        {
            if (_copies.Any(copy => !copy.ContainsKey(page))) continue;
            for (var offset = 0; offset < PageSize; offset++)
            {
                for (var step = 0; step < steps; step++) bytes[step] = _copies[step][page][offset];
                if (FitsLinear(bytes, positions))
                {
                    Add(matches, counts, "byte", page + (ulong)offset, bytes);
                }
                else
                {
                    // −1/0/+1 style settings stored in one byte read as 255/0/1 unsigned.
                    for (var step = 0; step < steps; step++) signedBytes[step] = unchecked((sbyte)_copies[step][page][offset]);
                    if (FitsLinear(signedBytes, positions)) Add(matches, counts, "sbyte", page + (ulong)offset, signedBytes);
                }

                if (offset % 2 == 0 && offset + 2 <= PageSize)
                {
                    for (var step = 0; step < steps; step++) words16[step] = BitConverter.ToInt16(_copies[step][page], offset);
                    if (FitsLinear(words16, positions) && !SameAsBytes(words16, bytes)) Add(matches, counts, "int16", page + (ulong)offset, words16);
                }

                if (offset % 4 == 0 && offset + 4 <= PageSize)
                {
                    var allOptions = true;
                    for (var step = 0; step < steps; step++)
                    {
                        var raw = BitConverter.ToUInt32(_copies[step][page], offset);
                        words32[step] = unchecked((int)raw);
                        floats[step] = BitConverter.Int32BitsToSingle(unchecked((int)raw));
                        if (!TacticSignatureScan.IsOptionId(raw)) allOptions = false;
                    }

                    if (allOptions && SamePattern(words32, positions)) Add(matches, counts, "ID de opção", page + (ulong)offset, words32);
                    if (FitsLinear(words32, positions) && !SameAsBytes(words32, bytes)) Add(matches, counts, "int32", page + (ulong)offset, words32);
                    // Floats: repeated script values must be bit-identical, and the value must really move.
                    if (SamePattern(words32, positions) && FitsLinearFloat(floats, positions)) Add(matches, counts, "float", page + (ulong)offset, words32);
                }
            }
        }

        Write($"--- Análise da série {_seriesIndex}: {steps} mudanças (posições do guião {string.Join(" ", positions)}), " +
              $"{_trackedPages.Count} páginas seguidas, {stopwatch.Elapsed.TotalSeconds:0.0} s.");
        Write($"    Candidatos que seguem valor = a·posição + b: {string.Join(", ", counts.Select(pair => $"{pair.Key} {pair.Value}"))}" +
              $"{(counts.Count == 0 ? "nenhum" : "")}.");

        // Integers and option ids first, each kind with its own cap; floats last (most prone to noise).
        var kindOrder = new[] { "ID de opção", "int32", "int16", "sbyte", "byte", "float" };
        var ordered = new List<Match>();
        foreach (var kind in kindOrder)
        {
            var ofKind = matches.Where(match => match.Kind == kind).OrderBy(match => match.Address).ToList();
            var cap = kind == "float" ? 60 : 300;
            foreach (var match in ofKind.Take(cap))
            {
                ordered.Add(match);
                Write($"      {match.Kind,-11} {Hex(match.Address)}  [{match.Values}]");
            }

            if (ofKind.Count > cap) Write($"      … mais {ofKind.Count - cap} do tipo {kind}");
        }

        // Context: the bytes around the first integer candidates, from the last snapshot.
        var integers = ordered.Where(match => match.Kind != "float").ToList();
        foreach (var match in integers.Take(16))
        {
            var page = match.Address & ~(ulong)(PageSize - 1);
            if (!_copies[^1].TryGetValue(page, out var last)) continue;
            var offset = (int)(match.Address - page);
            var from = Math.Max(0, (offset - 0x40) & ~0xF);
            var to = Math.Min(PageSize, from + 0x90);
            Write($"    Contexto de {Hex(match.Address)} ({match.Kind}), última fotografia:");
            for (var line = from; line < to; line += 16)
            {
                Write($"      {Hex(page + (ulong)line)}  {Convert.ToHexString(last, line, Math.Min(16, to - line))}");
            }
        }

        // Mentality, tempo and line are probably in the same structure: flag candidates near earlier series' ones.
        var nearLines = 0;
        foreach (var match in integers)
        {
            foreach (var earlier in _previousCandidates)
            {
                var distance = (long)match.Address - (long)earlier.Address;
                if (Math.Abs(distance) <= 0x400 && nearLines++ < 200)
                {
                    Write($"    ◀ PERTO: série {_seriesIndex} {match.Kind} {Hex(match.Address)} fica a {distance:+#;-#;0} bytes de " +
                          $"série {earlier.Series} {earlier.Kind} {Hex(earlier.Address)}");
                }
            }
        }

        _previousCandidates.AddRange(integers.Take(2_000).Select(match => (_seriesIndex, match.Kind, match.Address)));
        TraceHolders(integers.Select(match => match.Address).Distinct().Take(MaxCandidatesTraced).ToList());

        Write($"=== Fim da série {_seriesIndex} ({stopwatch.Elapsed.TotalSeconds:0.0} s). Podes começar a próxima com Ctrl+F9.");
        ResetSeries();
        Beep(660, 120);
        Thread.Sleep(80);
        Beep(990, 200);
    }

    private void ResetSeries()
    {
        _snapshotIndex = 0;
        _copies.Clear();
        _trackedPages = null;
        _noisyPages = null;
        GC.Collect();
    }

    private readonly record struct Match(string Kind, ulong Address, string Values);

    private static void Add(List<Match> matches, Dictionary<string, int> counts, string kind, ulong address, long[] values)
    {
        // Cap per kind, so a flood of one kind (floats) never crowds out another (bytes).
        counts[kind] = counts.GetValueOrDefault(kind) + 1;
        if (counts[kind] <= 5_000)
        {
            matches.Add(new Match(kind, address, string.Join(" ", values.Select(value =>
                kind is "ID de opção" or "float" ? ((uint)value).ToString("X8", CultureInfo.InvariantCulture) : value.ToString(CultureInfo.InvariantCulture)))));
        }
    }

    /// <summary>value = a·position + b with a ≠ 0, exactly (integer arithmetic, no division).</summary>
    private static bool FitsLinear(long[] values, int[] positions)
    {
        var j = Array.FindIndex(positions, position => position != positions[0]);
        if (j < 0) return false;
        var numerator = values[j] - values[0];
        var denominator = positions[j] - positions[0];
        if (numerator == 0) return false;
        for (var k = 1; k < values.Length; k++)
        {
            if ((values[k] - values[0]) * denominator != numerator * (positions[k] - positions[0])) return false;
        }

        return true;
    }

    private static bool FitsLinearFloat(double[] values, int[] positions)
    {
        foreach (var value in values)
        {
            if (!double.IsFinite(value) || Math.Abs(value) > 1e6) return false;
        }

        var j = Array.FindIndex(positions, position => position != positions[0]);
        if (j < 0) return false;
        var slope = (values[j] - values[0]) / (positions[j] - positions[0]);
        var scale = Math.Max(1e-3, values.Max(Math.Abs));
        var tolerance = 1e-4 * scale;
        // The change across the script must be large compared with the fitting tolerance.
        var spread = positions.Max() - positions.Min();
        if (Math.Abs(slope) * spread < 0.01 * scale) return false;
        for (var k = 1; k < values.Length; k++)
        {
            if (Math.Abs(values[0] + slope * (positions[k] - positions[0]) - values[k]) > tolerance) return false;
        }

        // Exclude what the byte/integer checks already report (small integers stored in the low byte).
        return values.Any(value => value != Math.Floor(value)) || values.Any(value => Math.Abs(value) >= 1);
    }

    /// <summary>Equal positions ↔ equal values (for option ids, which are not linear).</summary>
    private static bool SamePattern(long[] values, int[] positions)
    {
        for (var a = 0; a < values.Length; a++)
        {
            for (var b = a + 1; b < values.Length; b++)
            {
                if ((positions[a] == positions[b]) != (values[a] == values[b])) return false;
            }
        }

        return true;
    }

    /// <summary>A wider word whose changes are just the low byte's is reported once, as a byte.</summary>
    private static bool SameAsBytes(long[] wide, long[] bytes)
    {
        for (var k = 1; k < wide.Length; k++)
        {
            if (wide[k] - wide[0] != bytes[k] - bytes[0]) return false;
        }

        return true;
    }

    /// <summary>Two-level pointer search for the given addresses; flags holders in game_plugin.dll or known objects.</summary>
    private void TraceHolders(List<ulong> targets)
    {
        if (targets.Count == 0)
        {
            Write("    (sem candidatos raros para seguir ponteiros)");
            return;
        }

        var module = GetModuleRange("game_plugin.dll");
        var known = SafeKnownObjects();
        var regions = EnumerateRegions(includeImage: true);

        var level1 = FindHolders(regions, targets);
        var unrooted = new List<ulong>();
        foreach (var target in targets)
        {
            Write($"    Ponteiros até {Hex(target)} (janela −0x{HolderWindow:X}):");
            var holders = level1.Where(holder => holder.Target <= target && target - holder.Target <= HolderWindow).Take(MaxHolders).ToList();
            if (holders.Count == 0) Write("      (nenhum)");
            foreach (var holder in holders)
            {
                var name = Describe(holder.Address, module, known);
                Write($"      {Hex(holder.Address)}{name} → {Hex(holder.Target)} (alvo−0x{target - holder.Target:X})");
                if (name.Length == 0 && unrooted.Count < 16) unrooted.Add(holder.Address);
            }
        }

        if (unrooted.Count == 0) return;
        var level2 = FindHolders(regions, unrooted);
        Write("    Segundo nível (quem aponta para os ponteiros acima):");
        foreach (var target in unrooted)
        {
            foreach (var holder in level2.Where(holder => holder.Target <= target && target - holder.Target <= HolderWindow).Take(8))
            {
                Write($"      {Hex(holder.Address)}{Describe(holder.Address, module, known)} → {Hex(holder.Target)} " +
                      $"(alvo {Hex(target)} − 0x{target - holder.Target:X})");
            }
        }
    }

    private static List<(ulong Address, ulong Target)> FindHolders(List<MemoryRegion> regions, List<ulong> targets)
    {
        var holders = new List<(ulong, ulong)>();
        var sorted = targets.OrderBy(target => target).ToArray();
        var min = sorted[0] - HolderWindow;
        var max = sorted[^1];
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
                    foreach (var target in sorted)
                    {
                        if (value <= target && target - value <= HolderWindow)
                        {
                            holders.Add((address + (ulong)index * 8, value));
                            break;
                        }
                    }

                    if (holders.Count > 20_000) return holders;
                }
            }
        }

        return holders;
    }

    private IReadOnlyList<KnownObject> SafeKnownObjects()
    {
        try { return _knownObjects(); }
        catch { return Array.Empty<KnownObject>(); }
    }

    private static string Describe(ulong address, (ulong Start, ulong End) module, IReadOnlyList<KnownObject> known)
    {
        if (address >= module.Start && address < module.End)
        {
            return $" = game_plugin.dll+0x{address - module.Start:X} ◀ RAIZ ESTÁVEL";
        }

        foreach (var item in known)
        {
            var start = (ulong)item.Address;
            if (address >= start && address < start + (ulong)item.Size) return $" = {item.Label}+0x{address - start:X}";
        }

        return "";
    }

    private static Dictionary<ulong, ulong> HashAllPages(out long bytes)
    {
        var hashes = new Dictionary<ulong, ulong>(1 << 20);
        bytes = 0;
        var buffer = new byte[ChunkBytes];
        foreach (var region in EnumerateRegions(includeImage: false))
        {
            for (ulong offset = 0; offset < region.Size; offset += ChunkBytes)
            {
                var length = (int)Math.Min(ChunkBytes, region.Size - offset);
                var address = region.Start + offset;
                if (!ReadInto(address, buffer, length)) continue;
                bytes += length;
                for (var page = 0; page + PageSize <= length; page += PageSize)
                {
                    hashes[address + (ulong)page] = HashPage(buffer.AsSpan(page, PageSize));
                }
            }
        }

        return hashes;
    }

    private static ulong HashPage(ReadOnlySpan<byte> page)
    {
        var words = MemoryMarshal.Cast<byte, ulong>(page);
        ulong hash = 0x9E3779B97F4A7C15;
        foreach (var word in words)
        {
            hash = (hash ^ word) * 0x100000001B3;
            hash ^= hash >> 29;
        }

        return hash;
    }

    private static (ulong Start, ulong End) GetModuleRange(string name)
    {
        var module = GetModuleHandle(name);
        if (module == default) return (0, 0);
        var peOffset = Marshal.ReadInt32(module + 0x3C);
        var sizeOfImage = (uint)Marshal.ReadInt32(module + peOffset + 0x50);
        return ((ulong)module, (ulong)module + sizeOfImage);
    }

    private static List<MemoryRegion> EnumerateRegions(bool includeImage)
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
            var typeOk = info.Type == MemPrivate || (includeImage && info.Type == MemImage);
            if (info.State == MemCommit && typeOk && writable && (info.Protect & PageGuard) == 0)
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

    private static string Hex(ulong value) => "0x" + value.ToString("X", CultureInfo.InvariantCulture);

    private void Write(string line)
    {
        lock (_logGate)
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
        _stopping = true;
        lock (_logGate)
        {
            _log?.Dispose();
            _log = null;
        }
    }

    private const uint MemCommit = 0x1000;
    private const uint MemPrivate = 0x20000;
    private const uint MemImage = 0x1000000;
    private const uint PageGuard = 0x100;

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);

    [DllImport("kernel32.dll")]
    private static extern bool Beep(uint frequency, uint duration);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern nint GetModuleHandle(string moduleName);

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
}
