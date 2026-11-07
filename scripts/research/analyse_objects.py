"""Find per-player engine object fields that follow a tactical setting (research, sessão 17).

Input: a TacticObjects log (full object dumps + changed words, with real time) and the steps of a
sweep ("HH:MM:SS.fff=level,…", e.g. mentality picks detected in the TacticEvents log). The content
of every followed slot is rebuilt over time; at the end of each step (just before the next pick)
each field is decoded as u8/i8/u16/i16/u32/i32/f32 and kept if equal levels give equal values and
the per-level values are strictly monotonic. Results are grouped by (offset, type) across slots,
since a tactic parameter should show up in the objects of several players.

Usage: python -I analyse_objects.py <objects.log> <steps> [--tail SECONDS]
"""
import collections
import re
import struct
import sys

sys.stdout.reconfigure(encoding="utf-8")


def seconds(hms: str) -> float:
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def load(path: str):
    """Timeline of (time, slot, offset, 8-byte little-endian bytes)."""
    header = re.compile(r"^\[(\d\d:\d\d:\d\d) \S+ tick \d+\] (\S+) (0x[0-9A-F]+) (.*)$")
    dump_line = re.compile(r"^\s+\+0x([0-9A-F]{3})  ([0-9A-F]{32})$")
    change_line = re.compile(r"^\s+\+0x([0-9A-F]{3})  ([0-9A-F]{16}) → ([0-9A-F]{16})$")
    events = []
    time = slot = None
    for line in open(path, encoding="utf8"):
        m = header.match(line)
        if m:
            time, slot = seconds(m.group(1)), m.group(2)
            continue
        if time is None:
            continue
        m = dump_line.match(line)
        if m:
            base = int(m.group(1), 16)
            raw = bytes.fromhex(m.group(2))
            events.append((time, slot, base, raw[:8]))
            events.append((time, slot, base + 8, raw[8:]))
            continue
        m = change_line.match(line)
        if m:
            # values were printed as big-endian hex of a little-endian u64
            events.append((time, slot, int(m.group(1), 16), bytes.fromhex(m.group(3))[::-1]))
    return events


def snapshot(events, t: float):
    state = {}
    for time, slot, offset, raw in events:
        if time > t:
            break
        state[(slot, offset)] = raw
    return state


FORMATS = [(1, "B", "u8"), (1, "b", "i8"), (2, "<H", "u16"), (2, "<h", "i16"), (4, "<I", "u32"), (4, "<i", "i32"), (4, "<f", "f32")]


def main() -> None:
    path, steps_text = sys.argv[1:3]
    tail = float(sys.argv[sys.argv.index("--tail") + 1]) if "--tail" in sys.argv else 15
    steps = [item.split("=") for item in steps_text.split(",")]
    times = [seconds(t) for t, _ in steps]
    levels = [int(level) for _, level in steps]
    samples = [times[i + 1] - 0.5 for i in range(len(times) - 1)] + [times[-1] + tail]
    events = sorted(load(path), key=lambda event: event[0])
    print(f"{len(events)} valores lidos; {len(levels)} passos")
    states = [snapshot(events, t) for t in samples]
    keys = set(states[0]).intersection(*states[1:])
    hits = collections.defaultdict(list)
    for slot, offset in keys:
        raws = [state[(slot, offset)] for state in states]
        for width, fmt, name in FORMATS:
            for byte in range(0, 8, width):
                values = [struct.unpack(fmt, raw[byte:byte + width])[0] for raw in raws]
                if name == "f32" and any(v != v or abs(v) > 1e7 for v in values):
                    continue
                by_level = collections.defaultdict(set)
                for level, value in zip(levels, values):
                    by_level[level].add(value)
                if any(len(v) > 1 for v in by_level.values()):
                    continue
                ordered = [next(iter(by_level[level])) for level in sorted(by_level)]
                if len(set(ordered)) < len(ordered):
                    continue
                if all(a < b for a, b in zip(ordered, ordered[1:])) or all(a > b for a, b in zip(ordered, ordered[1:])):
                    hits[(offset + byte, name)].append((slot, ordered))

    print(f"{sum(len(v) for v in hits.values())} campos (em {len(hits)} posições/tipos) seguem o nível estritamente:")
    for (position, name), found in sorted(hits.items(), key=lambda item: -len(item[1]))[:40]:
        slots = sorted({slot for slot, _ in found})
        print(f"  +0x{position:03X} {name:3} em {len(slots)} objeto(s): {', '.join(slots[:8])}{' …' if len(slots) > 8 else ''}")
        for slot, ordered in found[:3]:
            print(f"      {slot}: por nível {ordered}")


if __name__ == "__main__":
    main()
