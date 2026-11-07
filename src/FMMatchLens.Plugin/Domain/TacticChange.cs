using System.Text.Json;
using System.Text.Json.Serialization;

namespace FMMatchLens.Plugin.Domain;

/// <summary>
/// A tactical change made by the human manager during a match, as seen on the channel the game UI
/// uses to talk to the native game (see <c>Memory/TacticChangeTracker</c>).
///
/// Kinds:
/// <list type="bullet">
/// <item><c>mentality</c> — absolute value 1 (very defensive) … 7 (very attacking). <see cref="Initial"/> marks the
/// value the match started with.</item>
/// <item><c>teamInstruction</c> — FM's <c>TacticTeamInstructions</c> id moved <see cref="Steps"/> levels
/// (positive = towards the end of the option list, e.g. Tempo 21: +1 = faster).</item>
/// <item><c>playerInstruction</c> — an individual instruction was stepped (player and instruction are not decoded).</item>
/// <item><c>swap</c> — players swapped in the match tactic (substitution or position swap).</item>
/// <item><c>confirmed</c> — a confirmation of tactical changes whose content could not be identified.</item>
/// <item><c>uiValues</c> — instructions drawn by the UI (team instructions panel, tactics screen, a player's
/// instructions), raw; <see cref="Initial"/> = seen before kick-off. Interpreted by the dashboard.</item>
/// </list>
///
/// The match engine only applies a change at the next stoppage; <see cref="AppliedTick"/> is the first
/// captured tick after the change with the ball out of play or standing still.
/// </summary>
internal sealed record TacticChange(
    int Sequence,
    string Kind,
    long CapturedUnixMilliseconds,
    int Tick,
    int DisplayTick,
    int? AppliedTick = null,
    int? AppliedDisplayTick = null,
    int? Mentality = null,
    string? MentalityName = null,
    int? PreviousMentality = null,
    bool Initial = false,
    int? Instruction = null,
    string? InstructionName = null,
    int? Steps = null,
    int? StepCount = null,
    IReadOnlyList<TacticUiValue>? UiValues = null);

/// <summary>
/// An instruction as drawn by the game UI: the option text in the game language and the icon id
/// (without the <c>tactic_icons-</c> prefix), which names the instruction, e.g. "Mais rápido" /
/// <c>in-possession-tempo-var-higher</c>. Icon variant names do not always match the option; the text does.
/// </summary>
internal sealed record TacticUiValue(string Icon, string Label);

internal static class TacticChangeKinds
{
    public const string Mentality = "mentality";
    public const string TeamInstruction = "teamInstruction";
    public const string PlayerInstruction = "playerInstruction";
    public const string Swap = "swap";
    public const string Confirmed = "confirmed";
    public const string UiValues = "uiValues";
}

/// <summary>
/// Archive payload of a tactic change record: UTF-8 JSON with a format version. A change is written when it
/// is made and written again (same sequence) when it is applied; readers keep the last record per sequence.
/// </summary>
internal static class TacticChangeCodec
{
    public const int FormatVersion = 1;

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static byte[] Encode(TacticChange change) =>
        JsonSerializer.SerializeToUtf8Bytes(new Envelope(FormatVersion, change), Options);

    public static TacticChange? Decode(byte[] payload)
    {
        try
        {
            var envelope = JsonSerializer.Deserialize<Envelope>(payload, Options);
            return envelope is { V: FormatVersion, Change: not null } ? envelope.Change : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Latest record per sequence, in sequence order.</summary>
    public static IReadOnlyList<TacticChange> Merge(IEnumerable<TacticChange> records) =>
        records
            .GroupBy(change => change.Sequence)
            .Select(group => group.Last())
            .OrderBy(change => change.Sequence)
            .ToArray();

    private sealed record Envelope(int V, TacticChange? Change);
}
