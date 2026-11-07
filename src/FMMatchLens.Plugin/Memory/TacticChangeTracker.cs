using System.Collections;
using System.Globalization;
using System.Reflection;
using FMMatchLens.Plugin.Diagnostics;
using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Services;
using HarmonyLib;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// Records the human manager's tactical changes during a match (config <c>Tactics.TrackChanges</c>).
///
/// The applied tactic is not reachable in the engine's memory (research sessions 1–17,
/// <c>docs/tactic-offsets.md</c>), so the changes are read where the UI sends them to the native game:
/// <list type="bullet">
/// <item><c>GameInteropSubsystem.SendEvent(uint id, target, value)</c> — quick changes of team instructions
/// (one event per level, value = <c>TacticTeamInstructions</c> id), individual instructions, player swaps and
/// each confirmation.</item>
/// <item><c>GamePlugin.PerformChannelActions(actions, requests)</c> — the UI's batched data binding. The
/// mentality only travels here, as display text. Three patterns were verified on real logs (24/24 picks found,
/// no false positives): a pick on the match bar (the name next to its number 1–7), the bar redrawn right after
/// a confirmation in the tactics screen, and the value shown before kick-off. The names are learnt from the
/// dropdown (numbers 1–7 followed by the 7 names), so any game language works.</item>
/// </list>
/// Only methods whose parameters are primitives, enums or references are patched: Harmony on IL2CPP corrupts
/// struct arguments and crashed the game (session 10). The prefixes only read their arguments and never throw.
/// </summary>
internal static class TacticChangeTracker
{
    private const uint SwapPlayers = 21;
    private const uint QuickChangeTacticInstructionIncrement = 862931569;
    private const uint QuickChangeTacticInstructionDecrement = 1249276755;
    private const uint QuickChangePlayerInstructionIncrement = 1668445233;
    private const uint QuickChangePlayerInstructionDecrement = 1668445234;
    private const uint ConfirmTacticalChanges = 1937405795;
    private const uint ModifyPendingTacticalChanges = 1865641760;
    private const uint TacticsScreenClosed = 1953719148;
    private const uint CancelTacticalChanges = 846559841;
    private const uint CancelPendingTacticalChanges = 1732789369;
    private const int MaxRequestsScanned = 400;
    private const long ConfirmDisplayWindowMilliseconds = 2_000;

    // Fallback names until the dropdown is seen (FM27 in Portuguese and English).
    private static readonly string[][] KnownMentalityNames =
    {
        new[] { "Muito Defensiva", "Defender", "Cautelosa", "Equilibrada", "Positiva", "Atacar", "Muito Atacante" },
        new[] { "Very Defensive", "Defensive", "Cautious", "Balanced", "Positive", "Attacking", "Very Attacking" },
    };

    private static readonly object Gate = new();
    private static readonly Dictionary<Type, Func<object, object?>?> Item2Readers = new();
    private static readonly Dictionary<Type, MethodInfo?> AsStringMethods = new();
    private static readonly Dictionary<Type, (PropertyInfo? Count, PropertyInfo? Item)> ListAccessors = new();
    private static readonly Dictionary<int, int> PendingTeamSteps = new();
    private static RealtimeMatchTimeline? _timeline;
    private static Type? _teamInstructionEnum;
    private static Harmony? _harmony;
    private static string[]? _learntNames;
    private static int _mentality;
    private static string? _mentalityName;
    private static int _pendingPlayerSteps;
    private static int _mentalityTraces;
    private static int _pendingPlayerStepCount;
    private static long _lastConfirmTimestamp;
    // A confirmation with no identified content, recorded once the mentality display window has passed.
    private static bool _unexplainedConfirm;
    // A swap or committed steps since the last confirmation explain that confirmation.
    private static bool _swappedSinceConfirm;
    private static long _lastStepTimestamp;
    private static int _eventTraces;
    private const long StepQuietMilliseconds = 2_000;

    public static bool IsInstalled => _harmony is not null;

    // Replaceable so recorded UI logs can be replayed outside the game (no BepInEx logger there).
    internal static Action<string> LogInfo { get; set; } = PluginLogger.Info;
    internal static Action<string> LogDebug { get; set; } = PluginLogger.Debug;
    internal static Action<string> LogWarning { get; set; } = PluginLogger.Warning;

    /// <summary>Milliseconds clock; replaceable so recorded UI logs can be replayed in tests.</summary>
    internal static Func<long> Now { get; set; } = () => Environment.TickCount64;

    public static void Install(RealtimeMatchTimeline timeline)
    {
        _timeline = timeline;
        timeline.MatchStarted += OnMatchStarted;

        var gamePlugin = LoadAssembly("FM.GamePlugin");
        var ui = LoadAssembly("FM.UI");
        _teamInstructionEnum = ui?.GetType("FM.UI.TacticTeamInstructions");
        var harmony = new Harmony("com.fmmatchlens.tactics");
        var patched = 0;
        foreach (var (typeName, methodName, parameters) in new[]
                 {
                     ("FM.GamePlugin.GameInteropSubsystem", "SendEvent", 3),
                     ("FM.GamePlugin.GamePlugin", "PerformChannelActions", 2),
                 })
        {
            var method = gamePlugin?.GetType(typeName)?
                .GetMethods(BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                .FirstOrDefault(candidate => candidate.Name == methodName && candidate.GetParameters().Length == parameters);
            if (method is null || !IsSafeToPatch(method))
            {
                PluginLogger.Warning($"Tactic tracking: {typeName}.{methodName} not found or not safe to patch.");
                continue;
            }

            var prefix = methodName == "SendEvent" ? nameof(SendEventPrefix) : nameof(ChannelActionsPrefix);
            harmony.Patch(method, prefix: new HarmonyMethod(typeof(TacticChangeTracker).GetMethod(prefix, BindingFlags.Static | BindingFlags.NonPublic)));
            patched++;
        }

        if (patched == 0) return;
        _harmony = harmony;
        PluginLogger.Info($"Tactic tracking installed ({patched}/2 game methods).");
    }

    public static void Uninstall()
    {
        _harmony?.UnpatchSelf();
        _harmony = null;
        if (_timeline is not null) _timeline.MatchStarted -= OnMatchStarted;
        _timeline = null;
    }

    private static Assembly? LoadAssembly(string name)
    {
        try
        {
            return AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(candidate => candidate.GetName().Name == name)
                   ?? Assembly.Load(name);
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Tactic tracking: unable to load {name}: {ex.Message}");
            return null;
        }
    }

    private static bool IsSafeToPatch(MethodInfo method) =>
        method.GetParameters().All(parameter =>
        {
            var type = parameter.ParameterType;
            return !type.IsByRef && (!type.IsValueType || type.IsPrimitive || type.IsEnum);
        });

    /// <summary>The mentality known when kick-off is recorded is the one the match started with.</summary>
    private static void OnMatchStarted()
    {
        lock (Gate)
        {
            PendingTeamSteps.Clear();
            _unexplainedConfirm = false;
            _swappedSinceConfirm = false;
            _pendingPlayerSteps = 0;
            _pendingPlayerStepCount = 0;
            if (_mentality > 0) RecordMentality(_mentality, _mentalityName, previous: null, initial: true, atKickOff: true);
            _lastUiSignature = null;
            if (PreMatchUiValues.Count > 0)
            {
                Record(Draft(TacticChangeKinds.UiValues) with { UiValues = PreMatchUiValues.Values.ToArray(), Initial = true }, atKickOff: true);
                PreMatchUiValues.Clear();
            }
        }
    }

    // ── SendEvent ────────────────────────────────────────────────────────

    private static void SendEventPrefix(object[] __args)
    {
        try
        {
            if (__args.Length < 3 || __args[0] is not uint id) return;
            if (IsTacticEvent(id) && _eventTraces++ < 500)
                LogDebug($"Tactic tracking: event {id} target={TargetName(__args[1])} value={AsString(__args[2])}.");
            switch (id)
            {
                case QuickChangeTacticInstructionIncrement:
                case QuickChangeTacticInstructionDecrement:
                    var raw = AsString(__args[2]);
                    if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var instruction))
                    {
                        LogWarning($"Tactic tracking: team instruction quick change with unreadable value '{raw}'.");
                        return;
                    }

                    lock (Gate)
                    {
                        PendingTeamSteps[instruction] = PendingTeamSteps.GetValueOrDefault(instruction) +
                                                        (id == QuickChangeTacticInstructionIncrement ? 1 : -1);
                        _lastStepTimestamp = Math.Max(1, Now());
                    }

                    break;
                case QuickChangePlayerInstructionIncrement:
                case QuickChangePlayerInstructionDecrement:
                    lock (Gate)
                    {
                        _pendingPlayerSteps += id == QuickChangePlayerInstructionIncrement ? 1 : -1;
                        _pendingPlayerStepCount++;
                        _lastStepTimestamp = Math.Max(1, Now());
                    }

                    break;
                case SwapPlayers:
                    // Before the match the same event edits the team selection (TeamTactic record).
                    if (!TargetName(__args[1]).Contains("MatchTactic", StringComparison.Ordinal)) return;
                    lock (Gate)
                    {
                        if (Record(Draft(TacticChangeKinds.Swap)) is not null) _swappedSinceConfirm = true;
                    }

                    break;
                case ConfirmTacticalChanges:
                    // The game also confirms on the match record by itself (half time, kick-off): not a change.
                    if (!TargetName(__args[1]).Contains("MatchTactic", StringComparison.Ordinal)) return;
                    lock (Gate)
                    {
                        FlushUnexplainedConfirm(force: true);
                        _lastConfirmTimestamp = Math.Max(1, Now());
                        _unexplainedConfirm = !(CommitPendingSteps() | _swappedSinceConfirm);
                        _swappedSinceConfirm = false;
                    }

                    break;
                case ModifyPendingTacticalChanges:
                case TacticsScreenClosed:
                    lock (Gate) CommitPendingSteps();
                    break;
                case CancelTacticalChanges:
                    // Leaving the tactics screen with "cancel": its unconfirmed steps never happened.
                    lock (Gate) DiscardPendingSteps();
                    break;
                case CancelPendingTacticalChanges:
                    lock (Gate)
                    {
                        DiscardPendingSteps();
                        var cancelled = _timeline?.CancelPendingTacticChanges() ?? 0;
                        LogInfo($"Tactic tracking: pending changes cancelled in game ({cancelled} discarded).");
                    }

                    break;
            }
        }
        catch (Exception ex)
        {
            Fail("SendEvent", ex);
        }
    }

    private static void DiscardPendingSteps()
    {
        PendingTeamSteps.Clear();
        _pendingPlayerSteps = 0;
        _pendingPlayerStepCount = 0;
        _lastStepTimestamp = 0;
        _unexplainedConfirm = false;
    }

    /// <summary>Records the quick-change steps made since the last commit. Returns whether anything was recorded.</summary>
    private static bool CommitPendingSteps()
    {
        var recorded = false;
        foreach (var (instruction, steps) in PendingTeamSteps)
        {
            if (steps == 0) continue;
            var name = _teamInstructionEnum is not null && Enum.IsDefined(_teamInstructionEnum, instruction)
                ? Enum.GetName(_teamInstructionEnum, instruction)
                : null;
            recorded |= Record(Draft(TacticChangeKinds.TeamInstruction) with
            {
                Instruction = instruction,
                InstructionName = name,
                Steps = steps,
            }) is not null;
        }

        PendingTeamSteps.Clear();
        _lastStepTimestamp = 0;
        if (_pendingPlayerStepCount > 0)
        {
            recorded |= Record(Draft(TacticChangeKinds.PlayerInstruction) with
            {
                Steps = _pendingPlayerSteps,
                StepCount = _pendingPlayerStepCount,
            }) is not null;
        }

        _pendingPlayerSteps = 0;
        _pendingPlayerStepCount = 0;
        if (recorded) _swappedSinceConfirm = true; // a following confirmation is explained
        return recorded;
    }

    // ── PerformChannelActions ────────────────────────────────────────────

    private static void ChannelActionsPrefix(object[] __args)
    {
        try
        {
            // Quick changes on the match screen may never be followed by a confirmation: record them once
            // the clicks stop (the steps of one change come ~150 ms apart).
            if (_lastStepTimestamp != 0 && Now() - _lastStepTimestamp >= StepQuietMilliseconds)
            {
                lock (Gate)
                {
                    if (_lastStepTimestamp != 0 && Now() - _lastStepTimestamp >= StepQuietMilliseconds) CommitPendingSteps();
                }
            }

            if (_unexplainedConfirm)
            {
                lock (Gate) FlushUnexplainedConfirm(force: false);
            }

            if (__args.Length < 2 || __args[1] is not { } requests) return;
            var count = CountOf(requests);
            if (count == 0) return; // almost every frame

            var values = new List<string?>(Math.Min(count, MaxRequestsScanned));
            foreach (var request in Items(requests, Math.Min(count, MaxRequestsScanned)))
            {
                values.Add(request is null ? null : AsString(Item2(request)));
            }

            lock (Gate) ObserveChannelValues(values);
        }
        catch (Exception ex)
        {
            Fail("ChannelActions", ex);
        }
    }

    private static void ObserveChannelValues(IReadOnlyList<string?> values)
    {
        ObserveUiValues(values);
        LearnMentalityNames(values);
        var found = -1;
        var value = 0;
        for (var index = 0; index < values.Count; index++)
        {
            var mentality = MentalityValue(values[index]);
            if (mentality == 0) continue;
            if (found >= 0) return; // the dropdown list or several names: not a single current value
            found = index;
            value = mentality;
        }

        if (found < 0) return;
        var number = value.ToString(CultureInfo.InvariantCulture);
        var pickedOnBar = (found > 0 && values[found - 1] == number) ||
                          (found + 1 < values.Count && values[found + 1] == number);
        var shownAfterConfirm = _lastConfirmTimestamp != 0 && Now() - _lastConfirmTimestamp <= ConfirmDisplayWindowMilliseconds;
        var inMatch = _timeline?.GetStatus() is { MatchId: not null, Status: not "ended" };
        if (_mentalityTraces++ < 200)
        {
            LogDebug($"Tactic tracking: mentality '{values[found]}' shown (bar pick={pickedOnBar}, " +
                               $"after confirm={shownAfterConfirm}, in match={inMatch}, current={_mentality}).");
        }

        if (!pickedOnBar && !shownAfterConfirm && inMatch && _mentality > 0) return;
        if (value == _mentality) return;

        var previous = _mentality > 0 ? _mentality : (int?)null;
        _mentality = value;
        _mentalityName = values[found];
        if (shownAfterConfirm)
        {
            _lastConfirmTimestamp = 0;
            _unexplainedConfirm = false;
        }
        if (inMatch) RecordMentality(value, values[found], previous, initial: previous is null, atKickOff: false);
    }

    private static bool IsTacticEvent(uint id) => id is SwapPlayers or QuickChangeTacticInstructionIncrement
        or QuickChangeTacticInstructionDecrement or QuickChangePlayerInstructionIncrement or QuickChangePlayerInstructionDecrement
        or ConfirmTacticalChanges or ModifyPendingTacticalChanges or TacticsScreenClosed or CancelTacticalChanges
        or CancelPendingTacticalChanges;

    private static TacticChange? Record(TacticChange draft, bool atKickOff = false)
    {
        var change = _timeline?.RecordTacticChange(draft, atKickOff);
        if (change is not null)
        {
            LogInfo($"Tactic change #{change.Sequence} at tick {change.Tick}: {change.Kind}" +
                              (change.Mentality is { } mentality ? $" mentality={mentality} ({change.MentalityName})" : "") +
                              (change.Instruction is { } instruction ? $" instruction={instruction} ({change.InstructionName})" : "") +
                              (change.Steps is { } steps ? $" steps={steps}" : "") +
                              (change.UiValues is { Count: > 0 } ui ? $" ui={string.Join(", ", ui.Select(pair => $"{pair.Label}{(pair.OptionKey is null ? "" : $" <{pair.OptionKey}>")} [{pair.Icon}]"))}" : "") +
                              (change.Cancelled ? " cancelled" : "") +
                              (change.PlayerName is null ? "" : $" player={change.PlayerName}") +
                              (change.Initial ? " initial" : ""));
        }
        else
        {
            LogDebug($"Tactic change '{draft.Kind}' ignored: no match being recorded.");
        }

        return change;
    }

    private static int _failures;

    internal static string? LastFailure { get; private set; }

    /// <summary>The prefixes never throw into the game; the first failures are logged.</summary>
    private static void Fail(string where, Exception ex)
    {
        LastFailure = $"{where}: {ex}";
        if (Interlocked.Increment(ref _failures) > 10) return;
        LogWarning($"Tactic tracking ({where}) failed: {ex.GetType().Name}: {ex.Message}");
    }

    private static void FlushUnexplainedConfirm(bool force)
    {
        if (!_unexplainedConfirm) return;
        if (!force && Now() - _lastConfirmTimestamp <= ConfirmDisplayWindowMilliseconds) return;
        _unexplainedConfirm = false;
        Record(Draft(TacticChangeKinds.Confirmed));
    }

    private const string IconPrefix = "tactic_icons-";

    // Instructions drawn before kick-off (latest per instruction), recorded as the starting state.
    private static readonly Dictionary<string, TacticUiValue> PreMatchUiValues = new(StringComparer.Ordinal);
    private static string? _lastUiSignature;

    /// <summary>
    /// The UI draws every instruction as its option text followed by an icon id
    /// (<c>tactic_icons-in-possession-tempo-var-higher</c>). Pairs are kept raw; the dashboard maps them.
    /// </summary>
    private static void ObserveUiValues(IReadOnlyList<string?> values)
    {
        RememberFeedbackKey(values);
        ObservePlayerHeader(values);
        List<TacticUiValue>? pairs = null;
        for (var index = 1; index < values.Count; index++)
        {
            var icon = values[index];
            if (icon is null || !icon.StartsWith(IconPrefix, StringComparison.Ordinal) ||
                icon.Contains("player_role", StringComparison.Ordinal)) continue;
            var label = values[index - 1];
            if (IsUiLabel(label))
            {
                (pairs ??= new List<TacticUiValue>()).Add(new TacticUiValue(icon[IconPrefix.Length..], label!));
            }
            else if (values.Count <= 10)
            {
                // A pick in an instruction's detail menu: only the tile icon is redrawn, right after the
                // feedback card of the chosen option.
                var key = Now() - _feedbackTimestamp <= 1_500 ? _feedbackKey : null;
                (pairs ??= new List<TacticUiValue>()).Add(new TacticUiValue(icon[IconPrefix.Length..], "", key));
            }
        }

        if (pairs is null) return;
        if (_timeline?.GetStatus() is not { MatchId: not null, Status: not "ended" })
        {
            foreach (var pair in pairs) PreMatchUiValues[UiKey(pair.Icon)] = pair;
            return;
        }

        var signature = string.Join("|", pairs.Select(pair => $"{pair.Icon}={pair.Label}{pair.OptionKey}"));
        if (signature == _lastUiSignature) return; // the same panel redrawn
        _lastUiSignature = signature;
        var playerPanel = pairs.Any(pair => IsPlayerInstructionIcon(pair.Icon));
        if (playerPanel && pairs.Count > 1)
        {
            // A player's instructions panel was drawn: his name comes in the panel header right after it
            // (~15 ms). Headers before it belong to other player cards.
            _panelPlayer = null;
        }

        var recorded = Record(Draft(TacticChangeKinds.UiValues) with
        {
            UiValues = pairs,
            PlayerName = playerPanel ? _panelPlayer : null,
        });
        if (recorded is not null && playerPanel && pairs.Count > 1)
        {
            _lastPlayerPanelSequence = recorded.Sequence;
            _lastPlayerPanelTimestamp = Math.Max(1, Now());
        }
    }

    private const long PlayerHeaderWindowMilliseconds = 1_000;
    private static string? _headerName;
    private static long _headerTimestamp;
    private static string? _panelPlayer;
    private static int _lastPlayerPanelSequence;
    private static long _lastPlayerPanelTimestamp;

    private static bool IsPlayerInstructionIcon(string icon) =>
        icon.StartsWith("player-instructions", StringComparison.Ordinal) ||
        icon.StartsWith("pi_", StringComparison.Ordinal);

    /// <summary>
    /// The header of a player's instructions panel is a link drawn as <c>\u0001{data}\u0002{name}\u0001</c>
    /// followed by a <c>PersonReference</c>. The same link appears on other player cards, so the name is only
    /// used when it comes within 1 s after a player's instructions panel was drawn.
    /// </summary>
    private static void ObservePlayerHeader(IReadOnlyList<string?> values)
    {
        if (values.Count > 20) return;
        for (var index = 0; index + 1 < values.Count; index++)
        {
            if (values[index + 1] != "FM.UI.PersonReference" || values[index] is not { Length: > 3 } link ||
                link[0] != '\u0001' || link[^1] != '\u0001') continue;
            var separator = link.LastIndexOf('\u0002');
            if (separator < 0 || separator >= link.Length - 2) continue;
            _headerName = link[(separator + 1)..^1];
            _headerTimestamp = Math.Max(1, Now());
            if (_lastPlayerPanelSequence != 0 && _headerTimestamp - _lastPlayerPanelTimestamp <= PlayerHeaderWindowMilliseconds)
            {
                // The panel came first: name it now.
                _panelPlayer = _headerName;
                var name = _headerName;
                _timeline?.AmendTacticChange(_lastPlayerPanelSequence, change => change with { PlayerName = name });
                LogInfo($"Tactic change #{_lastPlayerPanelSequence}: player {name}.");
                _lastPlayerPanelSequence = 0;
            }

            return;
        }
    }

    private static string? _feedbackKey;
    private static long _feedbackTimestamp;

    /// <summary>
    /// The feedback card of an option starts with the instruction id twice and the game's internal option name
    /// ("Attacking Width Wide"), then the description.
    /// </summary>
    private static void RememberFeedbackKey(IReadOnlyList<string?> values)
    {
        if (values.Count < 5 || values[0] is not { Length: > 0 } id || values[1] != id || !id.All(char.IsDigit)) return;
        if (values[2] is not { Length: > 3 } key || !char.IsUpper(key[0]) || !key.Contains(' ') ||
            !key.All(character => character is ' ' or (>= 'A' and <= 'Z') or (>= 'a' and <= 'z'))) return;
        _feedbackKey = key;
        _feedbackTimestamp = Math.Max(1, Now());
    }

    private static bool IsUiLabel(string? text) =>
        !string.IsNullOrWhiteSpace(text) && text.Length <= 80 && text != "null" &&
        !text.StartsWith(IconPrefix, StringComparison.Ordinal) &&
        !text.StartsWith("FM.", StringComparison.Ordinal) &&
        !text.StartsWith("SI.", StringComparison.Ordinal) &&
        !text.StartsWith("System.", StringComparison.Ordinal);

    /// <summary>Icon id without its option part, to keep one pre-match value per instruction.</summary>
    private static string UiKey(string icon)
    {
        foreach (var separator in new[] { "-var-", "-variation-", "-type-", "-Property-" })
        {
            var at = icon.IndexOf(separator, StringComparison.Ordinal);
            if (at > 0) return icon[..at];
        }

        return icon;
    }

    private static void RecordMentality(int value, string? name, int? previous, bool initial, bool atKickOff) =>
        Record(
            Draft(TacticChangeKinds.Mentality) with
            {
                Mentality = value,
                MentalityName = name,
                PreviousMentality = previous,
                Initial = initial,
            },
            atKickOff);

    /// <summary>The dropdown sends the numbers 1–7 followed by the 7 names in the game language.</summary>
    private static void LearnMentalityNames(IReadOnlyList<string?> values)
    {
        for (var start = 0; start + 14 <= values.Count; start++)
        {
            if (values[start] != "1") continue;
            var matches = true;
            for (var offset = 0; offset < 7 && matches; offset++)
            {
                matches = values[start + offset] == (offset + 1).ToString(CultureInfo.InvariantCulture) &&
                          values[start + 7 + offset] is { Length: > 0 } name &&
                          !char.IsDigit(name[0]);
            }

            if (!matches) continue;
            _learntNames = Enumerable.Range(start + 7, 7).Select(index => values[index]!).ToArray();
            return;
        }
    }

    private static int MentalityValue(string? text)
    {
        if (string.IsNullOrEmpty(text) || char.IsDigit(text[0])) return 0;
        if (_learntNames is not null)
        {
            var learnt = Array.IndexOf(_learntNames, text);
            if (learnt >= 0) return learnt + 1;
        }

        foreach (var names in KnownMentalityNames)
        {
            var known = Array.IndexOf(names, text);
            if (known >= 0) return known + 1;
        }

        return 0;
    }

    // ── Reflection helpers (cached per type) ────────────────────────────

    private static TacticChange Draft(string kind) => new(0, kind, 0, 0, 0);

    /// <summary>
    /// <c>Item2</c> of the request tuple. Il2CppInterop exposes the fields of IL2CPP value types as
    /// properties, so look for both (a managed ValueTuple has a field).
    /// </summary>
    private static object? Item2(object request)
    {
        var type = request.GetType();
        Func<object, object?>? read;
        lock (Item2Readers)
        {
            if (!Item2Readers.TryGetValue(type, out read))
            {
                var field = type.GetField("Item2", BindingFlags.Instance | BindingFlags.Public);
                var property = type.GetProperty("Item2", BindingFlags.Instance | BindingFlags.Public);
                read = field is not null ? field.GetValue : property is not null ? property.GetValue : null;
                Item2Readers[type] = read;
                if (read is null) Fail("ChannelActions", new MissingMemberException(type.FullName, "Item2"));
            }
        }

        return read?.Invoke(request);
    }

    private static string? AsString(object? value)
    {
        if (value is null) return null;
        var type = value.GetType();
        MethodInfo? method;
        lock (AsStringMethods)
        {
            if (!AsStringMethods.TryGetValue(type, out method))
            {
                method = type.GetMethod("AsString", Type.EmptyTypes);
                AsStringMethods[type] = method;
            }
        }

        return method is null ? value.ToString() : method.Invoke(value, null) as string;
    }

    private static string TargetName(object? target)
    {
        if (target is null) return "";
        try
        {
            return target.GetType().GetProperty("ID")?.GetValue(target)?.ToString() ?? target.ToString() ?? "";
        }
        catch
        {
            return "";
        }
    }

    private static (PropertyInfo? Count, PropertyInfo? Item) Accessors(Type type)
    {
        lock (ListAccessors)
        {
            if (!ListAccessors.TryGetValue(type, out var accessors))
            {
                accessors = (type.GetProperty("Count"), type.GetProperty("Item"));
                ListAccessors[type] = accessors;
            }

            return accessors;
        }
    }

    private static int CountOf(object list) =>
        list is ICollection collection ? collection.Count : Accessors(list.GetType()).Count?.GetValue(list) as int? ?? 0;

    private static IEnumerable<object?> Items(object list, int limit)
    {
        if (list is IList managed)
        {
            for (var index = 0; index < Math.Min(managed.Count, limit); index++) yield return managed[index];
            yield break;
        }

        var item = Accessors(list.GetType()).Item;
        if (item is null) yield break;
        for (var index = 0; index < limit; index++)
        {
            yield return item.GetValue(list, new object[] { index });
        }
    }
}
