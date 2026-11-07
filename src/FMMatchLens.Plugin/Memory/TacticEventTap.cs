using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Text;
using HarmonyLib;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// Research-only tap (config <c>Research.TacticEvents</c>, off by default) on the channel the game
/// UI uses to send changes to the native game: <c>FM.GamePlugin.GamePlugin.SendEvent(UInt32 id,
/// InteropReference target, TypedValue data)</c> (and the same method on
/// <c>GameInteropSubsystem</c>). Every call is logged with the event name, the target reference and
/// the value, plus real time and match clock — so each tactical change made in the UI shows up as
/// it is sent.
///
/// The methods are found by reflection at runtime, so the plugin has no compile-time dependency on
/// the game's interop assemblies. The prefix never throws into the game and never changes
/// arguments; it only reads them.
/// </summary>
internal static class TacticEventTap
{
    private static readonly object Gate = new();
    private static StreamWriter? _log;
    private static Func<string>? _clock;
    private static Type? _eventIdEnum;
    private static long _events;
    private static long _otherWrites;
    private static long _channelBatches;
    private const long MaxChannelBatches = 5_000;
    private static Type? _teamInstructionEnum;
    private static Type? _mentalityEnum;
    private static MethodInfo? _tryGetBaselineOption;
    private static long _lastDecode;
    private static string? _lastTeamInstructions;
    private static int _lastMentality = -1;
    private static long _lastMentalityTime;
    private const long MaxOtherWrites = 2_000;

    public static string? LogPath { get; private set; }

    public static void Install(string logPath, Func<string> clock)
    {
        LogPath = logPath;
        _clock = clock;
        Write($"=== Escuta de eventos interface → jogo ({DateTime.Now:yyyy-MM-dd HH:mm:ss}).");

        Assembly? assembly;
        try
        {
            assembly = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(candidate => candidate.GetName().Name == "FM.GamePlugin")
                       ?? Assembly.Load("FM.GamePlugin");
        }
        catch (Exception ex)
        {
            Write($"Não foi possível carregar FM.GamePlugin: {ex.Message}");
            return;
        }

        _eventIdEnum = assembly.GetType("FM.GamePlugin.InteropEventIDs");
        var harmony = new Harmony("com.fmmatchlens.research.tacticevents");
        var prefix = new HarmonyMethod(typeof(TacticEventTap).GetMethod(nameof(Prefix), BindingFlags.Static | BindingFlags.NonPublic));
        var patched = 0;
        // (type, method, parameter count). Only methods whose parameters are plain interop objects or
        // primitives — Span-based ones are left alone (risky to marshal through Harmony on IL2CPP).
        // Session 10 crashed the game right after the first intercepted SetData(DataKey, TypedValue):
        // Harmony on IL2CPP corrupts struct (non-primitive value type) arguments. Only methods whose
        // parameters are all primitives, enums or reference types are patched; see IsSafeToPatch.
        Assembly? ui = null;
        try { ui = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(candidate => candidate.GetName().Name == "FM.UI") ?? Assembly.Load("FM.UI"); }
        catch (Exception ex) { Write($"Não foi possível carregar FM.UI: {ex.Message}"); }

        if (ui is not null)
        {
            _teamInstructionEnum = ui.GetType("FM.UI.TacticTeamInstructions");
            _mentalityEnum = ui.GetType("FM.UI.TacticMentalities");
            _tryGetBaselineOption = ui.GetType("FM.UI.TacticalTweakVisualFunctions")?
                .GetMethods(BindingFlags.Static | BindingFlags.Public)
                .FirstOrDefault(method => method.Name == "TryGetBaselineOption" && method.GetParameters().Length == 3);
            Write($"TryGetBaselineOption {(_tryGetBaselineOption is null ? "NÃO encontrado" : "encontrado")}.");
        }

        var targets = new (Assembly? Assembly, string Type, string Method, int Parameters)[]
        {
            (assembly, "FM.GamePlugin.GameInteropSubsystem", "SendEvent", 3),
            // Batched channel writes from the UI (lists → safe to patch); mentality should travel here.
            (assembly, "FM.GamePlugin.GamePlugin", "PerformChannelActions", 2),
            // The tactics UI passes the tactic (a TypedValue record) to these helpers while drawing.
            (ui, "FM.UI.TacticalTweakVisualFunctions", "IsAnyTeamInstructionTweaked", 1),
            (ui, "FM.UI.TacticalTweakVisualFunctions", "IsAnyTeamInstructionPending", 1),
            // Called with the mentality whenever the UI writes a mentality name.
            (ui, "FM.UI.TacticalTweakData", "MentalityValueTranslationID", 1),
        };
        foreach (var (owner, typeName, methodName, parameterCount) in targets)
        {
            var type = owner?.GetType(typeName);
            if (type is null)
            {
                Write($"Tipo não encontrado: {typeName}");
                continue;
            }

            var candidates = type.GetMethods(BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                .Where(method => method.Name == methodName && method.GetParameters().Length == parameterCount)
                .ToList();
            if (candidates.Count == 0) Write($"Método não encontrado: {typeName}.{methodName} ({parameterCount} parâmetros)");
            foreach (var method in candidates)
            {
                var signature = $"{typeName}.{methodName}({string.Join(", ", method.GetParameters().Select(p => p.ParameterType.Name))})";
                if (!IsSafeToPatch(method))
                {
                    Write($"Recusado (parâmetros com estruturas, crasha o jogo): {signature}");
                    continue;
                }

                try
                {
                    harmony.Patch(method, prefix: prefix);
                    patched++;
                    Write($"Intercetado: {signature}");
                }
                catch (Exception ex)
                {
                    Write($"Falhou intercetar {signature}: {ex.GetType().Name}: {ex.Message}");
                }
            }
        }

        Write(patched > 0
            ? "Pronto. Abre o ecrã de táticas e muda instruções: cada envio aparece aqui."
            : "Nenhum método intercetado — a escuta não está ativa.");
    }

    /// <summary>
    /// Harmony on IL2CPP only passes primitives, enums and reference types through intact; struct
    /// arguments (Span, DataKey, Key, PropertyID, ChannelAction…) get corrupted and crash the game.
    /// </summary>
    private static bool IsSafeToPatch(MethodInfo method) =>
        method.GetParameters().All(parameter =>
        {
            var type = parameter.ParameterType;
            return !type.IsByRef && (!type.IsValueType || type.IsPrimitive || type.IsEnum);
        });

    // Channel key → "record · property", learned from OpenChannel, used to annotate later writes.
    private static readonly Dictionary<string, string> ChannelNames = new(StringComparer.Ordinal);

    // Harmony prefix: read-only, never throws, never skips the original.
    private static void Prefix(MethodBase __originalMethod, object[] __args)
    {
        try
        {
            var owner = __originalMethod.DeclaringType?.Name;
            var stamp = $"[{DateTime.Now:HH:mm:ss.fff} {SafeClock()}]";
            switch (__originalMethod.Name)
            {
                case "SendEvent":
                {
                    var count = Interlocked.Increment(ref _events);
                    var id = __args.Length > 0 && __args[0] is uint raw ? raw : 0u;
                    var name = _eventIdEnum is not null && Enum.IsDefined(_eventIdEnum, id) ? Enum.GetName(_eventIdEnum, id) : null;
                    // Both GamePlugin and GameInteropSubsystem forward the same event: log it once.
                    if (owner == "GamePlugin") return;
                    Write($"{stamp} #{count} EVENTO {name ?? "?"} ({id}) alvo={Describe(__args[1], 0)} valor={Describe(__args[2], 0)}");
                    break;
                }

                case "PerformChannelActions":
                {
                    if (__args[0] is null || __args[1] is null) return;
                    var actionCount = CountOf(__args[0]!);
                    var requestCount = CountOf(__args[1]!);
                    if (actionCount == 0 && requestCount == 0) return; // every frame, nothing to do

                    var actions = Items(__args[0]!, 20_000).ToList();
                    // Writes and property bindings are what matter; the rest is UI tree building.
                    var interesting = actions
                        .Select((action, index) => (Index: index, Mode: FieldText(action, "mode"), Key: FieldText(action, "key"),
                                                    Extra: FieldText(action, "additionalKey")))
                        .Where(action => action.Mode is "UpdateChannelData" or "SetPropertyID")
                        .ToList();
                    // The match clock is rewritten every second through one channel: skip batches that only do that.
                    if (interesting.All(action => action.Key == NoisyClockKey) && actionCount <= 2) return;
                    if (Interlocked.Increment(ref _channelBatches) > MaxChannelBatches) return;

                    var lines = new StringBuilder();
                    lines.Append($"{stamp} CANAIS {actionCount} ações, {requestCount} pedidos");
                    foreach (var action in interesting.Where(action => action.Key != NoisyClockKey).Take(60))
                    {
                        lines.Append($"\n      ação[{action.Index}] {action.Mode} chave={action.Key}" +
                                     (action.Mode == "SetPropertyID" ? $" propriedade={action.Extra}" : ""));
                    }

                    var requestIndex = 0;
                    foreach (var request in Items(__args[1]!, 200))
                    {
                        // ValueTuple<int, TypedValue, InteropReference, List<ChannelData>>
                        var index = FieldText(request, "Item1");
                        var value = Describe(FieldValue(request, "Item2"), 1);
                        var target = Describe(FieldValue(request, "Item3"), 1);
                        var properties = FieldValue(request, "Item4") is { } list
                            ? string.Join(",", Items(list, 40).Select(item => $"{FieldText(item, "property")}@{FieldText(item, "key")}"))
                            : "";
                        if (int.TryParse(index, out var actionIndex) && actionIndex >= 0 && actionIndex < actions.Count &&
                            FieldText(actions[actionIndex], "key") == NoisyClockKey)
                        {
                            continue;
                        }

                        lines.Append($"\n      pedido[{requestIndex++}] ação={index} valor={value} alvo={target} propriedades=[{properties}]");
                    }

                    Write(lines.ToString());
                    break;
                }

                case "IsAnyTeamInstructionTweaked":
                case "IsAnyTeamInstructionPending":
                {
                    // Hot path while the tactics UI draws: decode at most every 300 ms, log only changes.
                    var now = Environment.TickCount64;
                    if (now - Interlocked.Read(ref _lastDecode) < 300) return;
                    Interlocked.Exchange(ref _lastDecode, now);
                    var decoded = DecodeTeamInstructions(__args[0]);
                    if (decoded is null) return;
                    lock (Gate)
                    {
                        if (decoded == _lastTeamInstructions) return;
                        _lastTeamInstructions = decoded;
                    }

                    Write($"{stamp} TÁTICA (via {__originalMethod.Name}): {decoded}");
                    break;
                }

                case "MentalityValueTranslationID":
                {
                    var raw = __args[0];
                    var value = Convert.ToInt32(raw, CultureInfo.InvariantCulture);
                    var name = _mentalityEnum is not null && Enum.IsDefined(_mentalityEnum, value) ? Enum.GetName(_mentalityEnum, value) : "?";
                    // The UI also writes every option of the mentality dropdown; log every value but
                    // collapse repeats of the same value within half a second.
                    var now = Environment.TickCount64;
                    lock (Gate)
                    {
                        if (value == _lastMentality && now - _lastMentalityTime < 500) return;
                        _lastMentality = value;
                        _lastMentalityTime = now;
                    }

                    Write($"{stamp} MENTALIDADE mostrada: {name} ({value})");
                    break;
                }

                case "OpenChannel":
                {
                    var record = Describe(__args[0], 0);
                    var property = Describe(__args[1], 0);
                    var key = Describe(__args[2], 0);
                    // Only tactic/match records: the UI opens thousands of channels for everything else.
                    if (!record.Contains("Tactic", StringComparison.OrdinalIgnoreCase) &&
                        !record.Contains("match", StringComparison.OrdinalIgnoreCase))
                    {
                        return;
                    }

                    lock (Gate) ChannelNames[key] = $"{ShortRecord(record)} · {property}";
                    Write($"{stamp} CANAL ABERTO chave={key} registo={record} propriedade={property}");
                    break;
                }

                default:
                {
                    var key = Describe(__args[0], 0);
                    string? channel;
                    lock (Gate) ChannelNames.TryGetValue(key, out channel);
                    // Writes to tactic channels are always logged; other UI writes only up to a cap.
                    if (channel is null && Interlocked.Increment(ref _otherWrites) > MaxOtherWrites) return;
                    Write($"{stamp} {owner}.{__originalMethod.Name} chave={key}{(channel is null ? "" : $" [{channel}]")} " +
                          $"valor={Describe(__args[1], 0)}");
                    break;
                }
            }
        }
        catch
        {
            // Never let research logging affect the game.
        }
    }

    /// <summary>
    /// Calls the UI's own TryGetBaselineOption(tactic, instruction, out option) for every team
    /// instruction. Returns "Instruction=Option; …" or null if the value is not a tactic.
    /// </summary>
    private static string? DecodeTeamInstructions(object? tactic)
    {
        if (tactic is null || _tryGetBaselineOption is null || _teamInstructionEnum is null) return null;
        var parts = new List<string>();
        foreach (var instruction in Enum.GetValues(_teamInstructionEnum))
        {
            if (Convert.ToInt32(instruction, CultureInfo.InvariantCulture) < 0) continue;
            var arguments = new[] { tactic, instruction, null };
            try
            {
                if (_tryGetBaselineOption.Invoke(null, arguments) is true)
                {
                    parts.Add($"{instruction}={arguments[2]}");
                }
            }
            catch
            {
                return null;
            }
        }

        return parts.Count == 0 ? null : string.Join("; ", parts);
    }

    private static string ShortRecord(string record)
    {
        var bracket = record.IndexOf(" [", StringComparison.Ordinal);
        return bracket > 0 ? record[..bracket] : record;
    }

    private static string SafeClock()
    {
        try { return _clock?.Invoke() ?? ""; }
        catch { return ""; }
    }

    /// <summary>Best-effort text for interop objects: TypedValue.AsString, list items, ID properties, ToString.</summary>
    private static string Describe(object? value, int depth)
    {
        if (value is null) return "null";
        if (depth > 3) return value.ToString() ?? "?";
        var type = value.GetType();
        try
        {
            if (type.GetMethod("AsString", Type.EmptyTypes) is { } asString)
            {
                var dataType = type.GetProperty("DataType")?.GetValue(value) as Type;
                return $"{asString.Invoke(value, null)}{(dataType is null ? "" : $" <{dataType.Name}>")}";
            }

            var parts = new List<string>();
            if (type.GetProperty("ID") is { } idProperty) parts.Add($"ID={idProperty.GetValue(value)}");
            if (type.GetProperty("m_id") is { } pairs && pairs.GetValue(value) is { } list)
            {
                parts.Add($"[{string.Join("; ", Items(list).Select(item => Describe(item, depth + 1)))}]");
            }

            var text = value.ToString();
            // Interop objects without their own ToString just print their type name: not useful.
            var baseName = (type.FullName ?? type.Name).Split('[')[0];
            var isTypeName = string.IsNullOrEmpty(text) || text == type.FullName || text.EndsWith("." + type.Name, StringComparison.Ordinal) ||
                             text.StartsWith(baseName, StringComparison.Ordinal) || text.Contains("." + type.Name.Split('`')[0] + "`", StringComparison.Ordinal);
            if (!isTypeName) parts.Insert(0, text!);
            if (parts.Count > 0) return string.Join(" ", parts);

            // Fall back to public fields (blittable structs such as ChannelAction, ValueTuple items)
            // and properties declared on the type (e.g. Pair key/value, DynamicReference parts).
            var members = type.GetFields(BindingFlags.Instance | BindingFlags.Public)
                .Take(8)
                .Select(field => $"{field.Name}={DescribeMember(field.GetValue(value), depth)}")
                .Concat(type.GetProperties(BindingFlags.Instance | BindingFlags.Public)
                    .Where(property => property.GetIndexParameters().Length == 0 && property.DeclaringType == type)
                    .Take(8)
                    .Select(property => $"{property.Name}={DescribeMember(property.GetValue(value), depth)}"));
            return $"{type.Name}{{{string.Join(", ", members)}}}";
        }
        catch (Exception ex)
        {
            return $"{type.Name}(erro: {ex.GetType().Name})";
        }
    }

    private static string DescribeMember(object? value, int depth) => value switch
    {
        null => "null",
        IFormattable formattable when value.GetType().IsPrimitive || value.GetType().IsEnum =>
            formattable.ToString(null, CultureInfo.InvariantCulture),
        string text => text,
        _ => Describe(value, depth + 1)
    };

    // Channel rewritten every second by the match clock (sessão 14).
    private const string NoisyClockKey = "2994855520794946279";

    private static object? FieldValue(object? owner, string name)
    {
        if (owner is null) return null;
        var type = owner.GetType();
        return type.GetField(name, BindingFlags.Instance | BindingFlags.Public)?.GetValue(owner)
               ?? type.GetProperty(name, BindingFlags.Instance | BindingFlags.Public)?.GetValue(owner);
    }

    private static string FieldText(object? owner, string name) =>
        FieldValue(owner, name) is { } value
            ? (value is IFormattable formattable ? formattable.ToString(null, CultureInfo.InvariantCulture) : value.ToString() ?? "")
            : "";

    private static int CountOf(object list) =>
        list.GetType().GetProperty("Count")?.GetValue(list) as int? ?? 0;

    /// <summary>Items of an Il2Cpp or managed list, via Count + indexer (at most <paramref name="limit"/>).</summary>
    private static IEnumerable<object?> Items(object list, int limit = 16)
    {
        if (list is IEnumerable enumerable && list is not string)
        {
            var taken = 0;
            foreach (var item in enumerable)
            {
                if (taken++ >= limit) yield break;
                yield return item;
            }

            yield break;
        }

        var type = list.GetType();
        var count = type.GetProperty("Count")?.GetValue(list) as int? ?? 0;
        var indexer = type.GetProperty("Item");
        for (var index = 0; index < Math.Min(count, limit) && indexer is not null; index++)
        {
            yield return indexer.GetValue(list, new object[] { index });
        }
    }

    private static void Write(string line)
    {
        lock (Gate)
        {
            if (_log is null)
            {
                if (LogPath is null) return;
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                var stream = new FileStream(LogPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                _log = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
            }

            _log.WriteLine(line);
        }
    }

    public static void Dispose()
    {
        lock (Gate)
        {
            _log?.Dispose();
            _log = null;
        }
    }
}
