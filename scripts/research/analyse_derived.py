"""Find engine fields that follow a tactical setting across a sweep (research, sessão 16).

Inputs: a TacticProbe v3 log (every memory change, with real time) and a TacticEvents log (the exact
real time of each EventFmxConfirmTacticalChanges). The user sweeps one setting through known levels,
one confirmed change per step, letting the match run a few seconds between steps so the engine
applies it. For every probed word we take its value at the end of each step (just before the next
confirmation) and keep the fields whose value is a strictly monotonic function of the level across
all steps (Spearman ±1). With 13 steps visiting 7 levels up and down, chance hits are negligible.

Usage:
  python -I analyse_derived.py <probe.log> <events.log> <levels> [--from HH:MM:SS] [--to HH:MM:SS]
  levels: comma-separated level of each confirmed step, in order (e.g. 1,2,3,4,5,6,7,6,5,4,3,2,1)
"""
import collections
import re
import struct
import sys

sys.stdout.reconfigure(encoding="utf-8")


def seconds(hms: str) -> float:
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def confirm_times(events_path: str, start: float, end: float) -> list[float]:
    times = []
    for line in open(events_path, encoding="utf8"):
        m = re.match(r"^\[(\d\d:\d\d:\d\d\.\d+) ", line)
        if m and "EventFmxConfirmTacticalChanges" in line:
            t = seconds(m.group(1))
            if start <= t <= end:
                times.append(t)
    return times


def load_changes(probe_path: str):
    line_re = re.compile(r"^\[(\d\d:\d\d:\d\d) \S+ tick \d+\] (.+?) \+0x([0-9A-F]{4})  ([0-9A-F]{16}) → ([0-9A-F]{16})")
    history = collections.defaultdict(list)
    for line in open(probe_path, encoding="utf8"):
        m = line_re.match(line)
        if m:
            t, region, offset, old, new = m.groups()
            # Player regions carry position/name in the label; keep the stable "slot" part.
            region = re.sub(r"^(Jogador \S+ slot \d+) .*$", r"\1", region.strip())
            history[(region, offset)].append((seconds(t), old, new))
    return history


def value_at(changes, t: float):
    """Value of the word at time t: last write before t, or the 'old' value of the first write after."""
    before = [c for c in changes if c[0] <= t]
    if before:
        return before[-1][2]
    after = [c for c in changes if c[0] > t]
    return after[0][1] if after else None


def decode(hex_word: str):
    raw = bytes.fromhex(hex_word)[::-1]
    for width, fmt, name in ((1, "B", "u8"), (1, "b", "i8"), (2, "<h", "i16"), (4, "<i", "i32"), (4, "<f", "f32")):
        for byte in range(0, 8, width):
            yield name, byte, struct.unpack(fmt, raw[byte:byte + width])[0]


def main() -> None:
    probe, events, levels_text = sys.argv[1:4]
    if "=" in levels_text:
        # Explicit steps "HH:MM:SS.fff=level,…" (e.g. mentality picked from the match bar, which sends
        # no ConfirmTacticalChanges; times come from the channel values in the events log).
        steps = [item.split("=") for item in levels_text.split(",")]
        confirms = [seconds(time) for time, _ in steps]
        levels = [int(level) for _, level in steps]
    else:
        levels = [int(x) for x in levels_text.split(",")]
        start = seconds(sys.argv[sys.argv.index("--from") + 1]) if "--from" in sys.argv else 0
        end = seconds(sys.argv[sys.argv.index("--to") + 1]) if "--to" in sys.argv else 1e9
        confirms = confirm_times(events, start, end)
    print(f"{len(confirms)} confirmações no intervalo; níveis do guião: {len(levels)}")
    if len(confirms) != len(levels):
        print("AVISO: o número de confirmações não bate com o guião — ajusta --from/--to ou os níveis.")
        return

    # Value at the end of each step = just before the next confirmation (or 60 s after the last one).
    sample_times = [confirms[i + 1] - 1 for i in range(len(confirms) - 1)] + [confirms[-1] + 60]
    history = load_changes(probe)
    hits = []
    for key, changes in history.items():
        words = [value_at(changes, t) for t in sample_times]
        if any(w is None for w in words):
            continue
        decoded = [list(decode(w)) for w in words]
        for index, (name, byte, _) in enumerate(decoded[0]):
            values = [d[index][2] for d in decoded]
            if name == "f32" and any(v != v or abs(v) > 1e7 for v in values):
                continue
            if len(set(values)) < 3:
                continue
            pairs = sorted(zip(levels, values))
            # strictly monotonic in level, and equal levels give equal values
            by_level = collections.defaultdict(set)
            for level, value in zip(levels, values):
                by_level[level].add(value)
            if any(len(v) > 1 for v in by_level.values()):
                continue
            ordered = [next(iter(by_level[level])) for level in sorted(by_level)]
            increasing = all(a < b for a, b in zip(ordered, ordered[1:]))
            decreasing = all(a > b for a, b in zip(ordered, ordered[1:]))
            if increasing or decreasing:
                hits.append((key, name, byte, ordered))

    print(f"{len(hits)} campos seguem o nível em todos os passos (mesmo valor no mesmo nível, ordem estrita):")
    for (region, offset), name, byte, ordered in hits[:200]:
        print(f"  {region[:48]:48} +0x{offset}+{byte} {name:3}  por nível: {ordered}")


if __name__ == "__main__":
    main()
