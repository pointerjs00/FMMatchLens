using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// Research-only probe (config <c>Research.TacticObjects</c>, off by default) for the per-player
/// objects the match engine derives from the tactic.
///
/// Session 16 showed that a mentality change is applied at the next stoppage by rewriting plain
/// data objects pointed to from the team structure (Team+0x1000…0x1260), often reallocating them.
/// This probe follows every pointer slot in Team+0xF00…0x1600 of both teams. When a slot points
/// somewhere new it dumps the whole object (0x400 bytes) with the tick; when the object's content
/// changes it logs the changed 8-byte words. Offsets are relative to the object, so the noise
/// learned during the first two in-game minutes keeps applying after a reallocation.
///
/// Read-only; runs on the tick-drain thread once per second.
/// </summary>
internal sealed class TacticObjectProbe : IDisposable
{
    private const int SlotStart = 0xF00;
    private const int SlotEnd = 0x1600;
    private const int ObjectSize = 0x400;
    private const int CalibrationTicks = 2 * 240;

    private readonly MemoryReader _reader = new();
    private readonly string _logPath;
    private readonly Dictionary<string, Slot> _slots = new(StringComparer.Ordinal);
    private readonly Dictionary<string, HashSet<int>> _noisyBySlot = new(StringComparer.Ordinal);
    private StreamWriter? _log;
    private nint _match;
    private int _firstTick = -1;
    private int _lastTick;
    private bool _calibrationReported;
    private long _lastObserved;

    public TacticObjectProbe(string logPath)
    {
        _logPath = logPath;
    }

    public string LogPath => _logPath;

    public void Observe(GameMatchTickRecord record, Func<nint, bool> isHumanTeam)
    {
        var now = Stopwatch.GetTimestamp();
        if (_lastObserved != 0 && now - _lastObserved < Stopwatch.Frequency) return;
        _lastObserved = now;

        using var scope = VirtualMemory.BeginReadScope();
        if (record.MatchAddress != _match || record.Tick < _lastTick - 240)
        {
            _match = record.MatchAddress;
            _firstTick = record.Tick;
            _calibrationReported = false;
            _slots.Clear();
            _noisyBySlot.Clear();
            Write("");
            Write($"=== Novo jogo: GameMatch {Hex(record.MatchAddress)}; casa {Hex(record.HomeTeam)} " +
                  $"(humano={isHumanTeam(record.HomeTeam)}), fora {Hex(record.AwayTeam)} (humano={isHumanTeam(record.AwayTeam)}). " +
                  "Calibração: 2 minutos de jogo sem mexer na tática.");
        }

        _lastTick = record.Tick;
        var calibrating = record.Tick - _firstTick < CalibrationTicks;
        if (!calibrating && !_calibrationReported)
        {
            _calibrationReported = true;
            Write($"[{Clock(record)}] Calibração terminada: {_noisyBySlot.Sum(pair => pair.Value.Count)} palavras de ruído em " +
                  $"{_noisyBySlot.Count} posições. Objetos de referência:");
            foreach (var (key, slot) in _slots.OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                Dump(record, key, slot.Address, slot.Content, "REFERÊNCIA");
            }
        }

        ObserveTeam("casa", record.HomeTeam, record, calibrating);
        ObserveTeam("fora", record.AwayTeam, record, calibrating);
    }

    private void ObserveTeam(string side, nint team, GameMatchTickRecord record, bool calibrating)
    {
        if (team == default) return;
        for (var offset = SlotStart; offset < SlotEnd; offset += IntPtr.Size)
        {
            if (!_reader.TryReadPointer(team + offset, out var target) || !LooksLikePointer(target)) continue;
            var key = $"{side}+0x{offset:X}";
            var content = ReadBlock(target);
            if (content is null) continue;

            if (!_slots.TryGetValue(key, out var slot))
            {
                _slots[key] = new Slot(target, content);
                if (!calibrating) Dump(record, key, target, content, "NOVO");
                continue;
            }

            if (slot.Address != target)
            {
                _slots[key] = new Slot(target, content);
                if (!calibrating) Dump(record, key, target, content, $"REALOCADO (antes {Hex(slot.Address)})");
                continue;
            }

            var noisy = _noisyBySlot.TryGetValue(key, out var set) ? set : _noisyBySlot[key] = new HashSet<int>();
            var changes = new StringBuilder();
            var changed = 0;
            for (var word = 0; word + 8 <= ObjectSize; word += 8)
            {
                var before = BitConverter.ToUInt64(slot.Content, word);
                var after = BitConverter.ToUInt64(content, word);
                if (before == after || noisy.Contains(word)) continue;
                if (calibrating)
                {
                    noisy.Add(word);
                    continue;
                }

                changed++;
                if (changed <= 48) changes.Append($"\n      +0x{word:X3}  {before:X16} → {after:X16}");
            }

            slot.Content = content;
            if (changed > 0)
            {
                Write($"[{Clock(record)}] {key} {Hex(target)} MUDOU {changed} palavra(s):{changes}");
            }
        }
    }

    private void Dump(GameMatchTickRecord record, string key, nint target, byte[] content, string reason)
    {
        var text = new StringBuilder($"[{Clock(record)}] {key} {Hex(target)} {reason}, objeto completo:");
        for (var offset = 0; offset < content.Length; offset += 16)
        {
            text.Append($"\n      +0x{offset:X3}  {Convert.ToHexString(content, offset, 16)}");
        }

        Write(text.ToString());
    }

    private static byte[]? ReadBlock(nint address)
    {
        if (!VirtualMemory.IsReadable(address, ObjectSize)) return null;
        var buffer = new byte[ObjectSize];
        Marshal.Copy(address, buffer, 0, ObjectSize);
        return buffer;
    }

    private static bool LooksLikePointer(nint value) =>
        value != default && (ulong)value >= 0x10000 && (ulong)value < 0x7FFF_FFFF_FFFF && (value & 7) == 0;

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

    private sealed class Slot
    {
        public Slot(nint address, byte[] content)
        {
            Address = address;
            Content = content;
        }

        public nint Address { get; }
        public byte[] Content { get; set; }
    }
}
