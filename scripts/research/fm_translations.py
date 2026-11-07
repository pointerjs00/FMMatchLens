"""Look up FM27's own translations, to map the option texts the UI shows (PT) to their meaning (EN).

Reads the local game installation (nothing from the game is stored in the repository):
  <FM27>/data/game_simulation/languages.fmf  — container, magic 02 01 'fmf.', not encrypted:
      index = last zstd frame: u32+name of the root, u32 count, then per entry
      u32+name, u32+extension, u64 offset, u64 packed, u64 size, u64 created, u64 modified;
      entry data at 0x19 + offset: one header byte, then zstd frames back to back.
  <language>.ltc — string table: 03 01 'ctl.', u32 at 0x10 = length of the language name, name, u32;
      records = u8 variant count + count x (u32 length + UTF-8 text);
      then u32 count + count x (u32 string id, u32 record offset counted from byte 8 of the file).
  The same string id in portuguese.ltc and english.ltc is the same text.

(Exported tactics, '.fmf' files with magic 'afe.', are encrypted and are not read.)

Usage:
  python -I fm_translations.py "<FM27 folder>" "Mais Compacto" "Mista" ...
prints, for each Portuguese text, every English text it translates in the game.
"""
import collections
import compression.zstd as zstd
import struct
import sys
from pathlib import Path


def fmf_entry(container: Path, wanted: str) -> bytes:
    data = container.read_bytes()
    index = zstd.decompress(data[data.rfind(b"\x28\xb5\x2f\xfd"):])
    pos = 0

    def u32():
        nonlocal pos
        value = struct.unpack_from("<I", index, pos)[0]
        pos += 4
        return value

    def text():
        nonlocal pos
        length = u32()
        value = index[pos:pos + length].decode("utf-8")
        pos += length
        return value

    text()
    for _ in range(u32()):
        name = text() + text()
        offset, packed, _size, _created, _modified = struct.unpack_from("<QQQQQ", index, pos)
        pos += 40
        if name != wanted:
            continue
        rest = data[0x19 + offset + 1: 0x19 + offset + packed]
        parts = []
        while rest:
            decompressor = zstd.ZstdDecompressor()
            parts.append(decompressor.decompress(rest))
            rest = decompressor.unused_data
        return b"".join(parts)
    raise KeyError(wanted)


def read_ltc(b: bytes) -> dict[int, list[str]]:
    name_length = struct.unpack_from("<I", b, 0x10)[0]
    i = 0x14 + name_length + 4
    records = {}
    while True:
        start = i - 8
        count = b[i]
        j = i + 1
        texts = []
        valid = True
        for _ in range(count):
            length = struct.unpack_from("<I", b, j)[0] if j + 4 <= len(b) else -1
            if length < 0 or length > 1_000_000 or j + 4 + length > len(b):
                valid = False
                break
            texts.append(b[j + 4:j + 4 + length].decode("utf-8", "replace"))
            j += 4 + length
        if not valid:
            break  # reached the id table
        records[start] = texts
        i = j
        if i + 4 <= len(b) and i + 4 + struct.unpack_from("<I", b, i)[0] * 8 == len(b):
            break
    total = struct.unpack_from("<I", b, i)[0]
    table = {}
    for k in range(total):
        ident, offset = struct.unpack_from("<II", b, i + 4 + 8 * k)
        table[ident] = records.get(offset)
    return table


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    container = Path(sys.argv[1]) / "data" / "game_simulation" / "languages.fmf"
    portuguese = read_ltc(fmf_entry(container, "portuguese.ltc"))
    english = read_ltc(fmf_entry(container, "english.ltc"))
    meanings = collections.defaultdict(set)
    for ident, texts in portuguese.items():
        if texts and english.get(ident):
            meanings[texts[0]].add(english[ident][0])
    for text in sys.argv[2:]:
        print(f"{text}: {sorted(meanings.get(text, set()))}")


if __name__ == "__main__":
    main()
