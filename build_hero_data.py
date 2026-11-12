# -*- coding: utf-8 -*-
"""
build_hero_data.py — Auto sync skin/icon từ id_skinnn.txt

Sinh / cập nhật:
  minibot/hero_data_full.json   — prefix + list skin code
  minibot/hero_icons.json       — icon CDN (display 130 · api 30_1300)
  minibot/skin_codes.json       — "Airi|Airi Mỵ hồ" → "13009"
  minibot/catalog.json          — list skin name cho Mini App (UI)
  Sources_Bot/<hero>/gốc.txt    — -->13009 : Airi Mỵ hồ  (bot chaymod)
  Sources_Bot/<hero>/sources.txt— Airi Mỵ hồ

Nguyên lý icon CDN (Garena KGVN):
  list  : 130
  hero  : {cdn}{prefix}0.jpg       → 301500.jpg (Nakroth default)
  skin  : {cdn}{prefix}{n}head.jpg → 301501head.jpg (skin id ≥ 1)

Cách chạy:
  py minibot/build_hero_data.py
  py minibot/build_hero_data.py --id-file id_skinnn.txt
  py minibot/build_hero_data.py --no-sources   # chỉ minibot JSON, không ghi Sources_Bot
  py minibot/build_hero_data.py --dry-run --diff
  py minibot/build_hero_data.py --check        # validate, exit 1 nếu lỗi
  py minibot/build_hero_data.py --backup
  py minibot/build_hero_data.py --hero Airi
  py minibot/build_hero_data.py --prune-sources  # xoá folder Sources_Bot lạ
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
MINIBOT = Path(__file__).resolve().parent
SOURCES_BOT = ROOT / "Sources_Bot"
DEFAULT_ID_CANDIDATES = (
    ROOT / "id_skinnn.txt",
    MINIBOT / "id_skinnn.txt",
    Path.cwd() / "id_skinnn.txt",
)
CDN_ID = "30"
CDN_BASE = "https://dl.ops.kgvn.garenanow.com/hok/VN/HeroHeadPath/"

# 3 id đặc biệt — bỏ qua (không vào catalog / Sources_Bot)
SKIP_PREFIXES = frozenset({"797", "798", "799"})

# Catalog keys không phải tướng (app.js EXTRA_KEYS) — không resolve làm hero
NON_HERO_KEYS = frozenset({"Cam Xa", "HD Chiêu", "Server"})

# Tên sai từng map nhầm prefix — không dùng lại khi resolve
BAD_NAME_PREFIX = {
    "EX": "159",       # đúng là Dolia
    "Edras": "194",    # đúng là SuLie
    "Flowborn": "577", # đúng là ShaoSiYuan
    "Tamyn": "582",    # đúng là Ciyuanfashi
}

# Override cứng prefix → tên hiển thị (khi skin/internal chưa đủ tin)
NAME_OVERRIDE: dict[str, str] = {
    # ví dụ: "194": "SuLie",
}

# Tên multi-word ưu tiên khi match từ skin label
SPECIAL_HERO_NAMES = (
    "The Flash",
    "Bolt Baron",
    "Wonder Woman",
    "Azzen'Ka",
    "Eland'orr",
    "Kil'Groth",
    "Tel'Annas",
    "Y'bneth",
    "D'Arcy",
)

# Icon URL convention (app.js):
#   hero default → 30{prefix}0.jpg       (301500.jpg)
#   skin n≥1     → 30{prefix}{n}head.jpg (301501head.jpg)

_TAG_RE = re.compile(r"^\[[^\]]*\]\s*")
_HERO_LINE_RE = re.compile(r"^(\d+)_(.+)$")
_SKIN_LINE_RE = re.compile(r"^-->(\d+)\s*:\s*(.+)$")


# ─── terminal UI ───────────────────────────────────────────────────────────

class UI:
    """Giao diện console (màu + box + progress). Tắt màu nếu không phải TTY."""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    CYAN = "\033[36m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    RED = "\033[31m"
    MAGENTA = "\033[35m"
    BLUE = "\033[34m"
    WHITE = "\033[97m"
    BG = "\033[44m"

    def __init__(self, enabled: bool | None = None, quiet: bool = False):
        self.quiet = quiet
        if enabled is None:
            enabled = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
        self.color = bool(enabled)
        self._enable_windows_ansi()
        self._bar_active = False

    def _enable_windows_ansi(self) -> None:
        if not self.color or os.name != "nt":
            return
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
            mode = ctypes.c_uint32()
            if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                kernel32.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL
        except Exception:
            pass
        try:
            # UTF-8 console code page
            os.system("")  # enable VT on some hosts
        except Exception:
            pass

    def c(self, text: str, *styles: str) -> str:
        if not self.color or not styles:
            return text
        return "".join(styles) + text + self.RESET

    def print(self, *args: object, **kwargs: Any) -> None:
        if self.quiet:
            return
        if self._bar_active:
            # clear progress line trước khi in log
            sys.stdout.write("\r" + " " * 80 + "\r")
            self._bar_active = False
        print(*args, **kwargs)

    def eprint(self, *args: object, **kwargs: Any) -> None:
        print(*args, file=sys.stderr, **kwargs)

    def rule(self, char: str = "─", width: int = 62) -> None:
        self.print(self.c(char * width, self.DIM, self.CYAN))

    def banner(self, title: str = "BUILD HERO DATA", subtitle: str = "sync skin · icon · catalog · Sources_Bot") -> None:
        if self.quiet:
            return
        w = 62
        top = "╔" + "═" * (w - 2) + "╗"
        bot = "╚" + "═" * (w - 2) + "╝"
        mid = "║" + " " * (w - 2) + "║"

        def row(text: str, style: str = "") -> str:
            # strip ANSI for length
            plain = re.sub(r"\033\[[0-9;]*m", "", text)
            pad = max(0, w - 4 - len(plain))
            left = pad // 2
            right = pad - left
            body = " " * left + text + " " * right
            return "║ " + body + " ║"

        self.print()
        self.print(self.c(top, self.CYAN, self.BOLD))
        self.print(self.c(mid, self.CYAN))
        self.print(self.c(row(self.c(title, self.BOLD, self.WHITE)), self.CYAN))
        self.print(self.c(row(self.c(subtitle, self.DIM)), self.CYAN))
        self.print(self.c(mid, self.CYAN))
        self.print(self.c(bot, self.CYAN, self.BOLD))
        self.print()

    def step(self, n: int, total: int, label: str) -> None:
        self.print(
            self.c(f"  [{n}/{total}]", self.BOLD, self.CYAN)
            + " "
            + self.c(label, self.WHITE)
        )

    def kv(self, key: str, value: object, icon: str = "•") -> None:
        self.print(
            f"  {self.c(icon, self.CYAN)} "
            f"{self.c(f'{key:<16}', self.DIM)} "
            f"{self.c(str(value), self.BOLD, self.WHITE)}"
        )

    def ok(self, msg: str) -> None:
        self.print(self.c("  ✔ ", self.GREEN, self.BOLD) + msg)

    def warn(self, msg: str) -> None:
        self.print(self.c("  ⚠ ", self.YELLOW, self.BOLD) + msg)

    def err(self, msg: str) -> None:
        self.eprint(self.c("  ✖ ", self.RED, self.BOLD) + msg)

    def info(self, msg: str) -> None:
        self.print(self.c("  › ", self.BLUE) + msg)

    def section(self, title: str) -> None:
        self.print()
        self.print(self.c(f"  ▸ {title}", self.BOLD, self.MAGENTA))
        self.rule("·", 40)

    def progress(self, current: int, total: int, label: str = "") -> None:
        if self.quiet or total <= 0:
            return
        # chỉ vẽ bar khi TTY
        if not sys.stdout.isatty():
            return
        width = 28
        ratio = min(1.0, max(0.0, current / total))
        filled = int(width * ratio)
        bar = "█" * filled + "░" * (width - filled)
        pct = int(ratio * 100)
        tail = f" {label}" if label else ""
        line = f"\r  {self.c(bar, self.CYAN)} {self.c(f'{pct:3d}%', self.BOLD)} ({current}/{total}){tail}"
        sys.stdout.write(line[:120])
        sys.stdout.flush()
        self._bar_active = True
        if current >= total:
            sys.stdout.write("\n")
            self._bar_active = False

    def summary_box(self, rows: list[tuple[str, str]], footer: str | None = None) -> None:
        if self.quiet:
            return
        w = 62
        self.print()
        self.print(self.c("  ┌" + "─" * (w - 4) + "┐", self.GREEN))
        self.print(self.c("  │" + " KẾT QUẢ ".center(w - 4) + "│", self.GREEN, self.BOLD))
        self.print(self.c("  ├" + "─" * (w - 4) + "┤", self.GREEN))
        for k, v in rows:
            plain = f" {k}: {v}"
            pad = max(1, w - 4 - len(plain))
            line = plain + " " * pad
            self.print(self.c("  │", self.GREEN) + line + self.c("│", self.GREEN))
        if footer:
            self.print(self.c("  ├" + "─" * (w - 4) + "┤", self.GREEN))
            plain = f" {footer}"
            pad = max(1, w - 4 - len(plain))
            self.print(self.c("  │", self.GREEN) + plain + " " * pad + self.c("│", self.GREEN))
        self.print(self.c("  └" + "─" * (w - 4) + "┘", self.GREEN))
        self.print()

    def pause(self, code: int = 0) -> None:
        """Giữ cửa sổ console — không thoát ngay khi double-click / chạy tay."""
        if self.quiet:
            return
        # non-interactive (pipe/CI) → bỏ qua
        if not sys.stdin.isatty():
            return
        self.rule()
        hint = "HOÀN TẤT" if code == 0 else f"THOÁT (code {code})"
        try:
            input(self.c(f"  {hint} — nhấn Enter để đóng cửa sổ… ", self.DIM, self.YELLOW))
        except (EOFError, KeyboardInterrupt):
            self.print()


# global UI instance (set in main)
ui = UI(enabled=False, quiet=True)


def eprint(*args: object, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def clean_skin_name(skin_name: str) -> str:
    """Bỏ tag vip [●]… và trim."""
    if not skin_name:
        return ""
    return _TAG_RE.sub("", skin_name).strip()


def resolve_id_file(explicit: str | None) -> Path:
    """Ưu tiên --id-file; không có thì lần lượt ROOT / minibot / cwd."""
    if explicit:
        p = Path(explicit)
        if not p.is_file():
            # thử relative từ ROOT / MINIBOT
            for base in (ROOT, MINIBOT, Path.cwd()):
                cand = (base / explicit).resolve()
                if cand.is_file():
                    return cand
            raise FileNotFoundError(f"Không thấy id file: {explicit}")
        return p.resolve()
    for cand in DEFAULT_ID_CANDIDATES:
        if cand.is_file():
            return cand.resolve()
    raise FileNotFoundError(
        "Không thấy id_skinnn.txt (đã thử: "
        + ", ".join(str(c) for c in DEFAULT_ID_CANDIDATES)
        + ")"
    )


def known_folder_names() -> list[str]:
    """Tên folder Sources_Bot + catalog (để khớp 'Airi Thích khách' → Airi)."""
    names: set[str] = set()
    if SOURCES_BOT.is_dir():
        for d in os.listdir(SOURCES_BOT):
            if (SOURCES_BOT / d).is_dir() and d not in BAD_NAME_PREFIX and d not in NON_HERO_KEYS:
                names.add(d)
    cat_path = MINIBOT / "catalog.json"
    if cat_path.is_file():
        try:
            for k in json.loads(cat_path.read_text(encoding="utf-8")):
                if k not in BAD_NAME_PREFIX and k not in NON_HERO_KEYS and not str(k).startswith("_"):
                    names.add(k)
        except Exception as exc:
            eprint(f"[warn] đọc catalog.json: {exc}")
    # special multi-word luôn có trong pool
    names.update(SPECIAL_HERO_NAMES)
    return sorted(names, key=len, reverse=True)


def parse_id_skinnn(path: Path) -> list[dict]:
    """
    Parse:
      ####
      130_GongBenWuZang
      -->13001 : Airi Thích khách
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    heroes: list[dict] = []
    cur = None
    orphan_skins = 0
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("####"):
            continue
        m_hero = _HERO_LINE_RE.match(line)
        if m_hero and not line.startswith("-->"):
            cur = {
                "prefix": m_hero.group(1),
                "code": line,
                "internal": m_hero.group(2),
                "skins": [],  # list[(code, name)]
            }
            heroes.append(cur)
            continue
        m_skin = _SKIN_LINE_RE.match(line)
        if m_skin:
            if cur is None:
                orphan_skins += 1
                continue
            cur["skins"].append((m_skin.group(1), m_skin.group(2).strip()))
    if orphan_skins:
        eprint(f"[warn] {orphan_skins} dòng skin không thuộc hero nào (bỏ qua)")
    return heroes


def name_from_skin_label(skin_name: str, folders: list[str]) -> str | None:
    """'Airi Thích khách' / 'Dolia Hoa tiêu…' → Airi / Dolia."""
    s = clean_skin_name(skin_name)
    if not s:
        return None
    # khớp folder dài nhất trước (The Flash, Wonder Woman, …)
    for key in folders:
        if not key or key in BAD_NAME_PREFIX or key in NON_HERO_KEYS:
            continue
        if s == key or s.startswith(key + " "):
            return key
    for special in SPECIAL_HERO_NAMES:
        if s == special or s.startswith(special + " "):
            return special
    parts = s.split()
    return parts[0] if parts else None


def resolve_hero_name(prefix: str, internal: str, skins: list, folders: list[str]) -> str:
    """
    Đúng id + đúng tên:
      0) NAME_OVERRIDE[prefix]
      1) Từ tên skin trong id_skinnn (ưu tiên tuyệt đối)
      2) Internal code trong id_skinnn: 593_MaChao → MaChao
    Không reverse map từ fallback sai (EX/Edras/…).
    """
    if prefix in NAME_OVERRIDE:
        return NAME_OVERRIDE[prefix]
    if skins:
        n = name_from_skin_label(skins[0][1], folders)
        if n and n not in BAD_NAME_PREFIX and n not in NON_HERO_KEYS:
            return n
    if internal and internal not in BAD_NAME_PREFIX and internal not in NON_HERO_KEYS:
        return internal
    return f"Hero{prefix}"


def write_sources_bot(hero_name: str, skins: list[tuple[str, str]]) -> None:
    """
    Cập nhật Sources_Bot/<hero>/ từ list skin id_skinnn:
      gốc.txt    : -->13009 : Airi Mỵ hồ\\r\\n  (có thể rỗng nếu chưa có skin)
      sources.txt: Airi Mỵ hồ\\r\\n
    """
    folder = SOURCES_BOT / hero_name
    folder.mkdir(parents=True, exist_ok=True)
    goc_lines = []
    src_lines = []
    for code, sname in skins:
        goc_lines.append(f"-->{code} : {sname}\r\n")
        src_lines.append(f"{sname}\r\n")
    (folder / "gốc.txt").write_bytes("".join(goc_lines).encode("utf-8"))
    (folder / "sources.txt").write_bytes("".join(src_lines).encode("utf-8"))


def load_json(path: Path) -> Any | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        eprint(f"[warn] không đọc được {path.name}: {exc}")
        return None


def atomic_write_json(path: Path, data: Any) -> int:
    """Ghi JSON an toàn (temp + replace). Trả về size bytes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return path.stat().st_size


def backup_outputs(paths: list[Path], backup_dir: Path | None = None) -> Path | None:
    existing = [p for p in paths if p.is_file()]
    if not existing:
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    bdir = backup_dir or (MINIBOT / "_backup" / stamp)
    bdir.mkdir(parents=True, exist_ok=True)
    for p in existing:
        shutil.copy2(p, bdir / p.name)
    return bdir


# ─── validate / diff ───────────────────────────────────────────────────────

def validate_build(out: dict) -> list[str]:
    """Trả về list issue (empty = OK)."""
    issues: list[str] = []
    hero_data: dict = out["hero_data"]
    skin_codes: dict = out["skin_codes"]
    catalog: dict = out["catalog"]

    # prefix trùng
    seen_prefix: dict[str, str] = {}
    for name, info in hero_data.items():
        pfx = str(info.get("prefix") or "")
        if not pfx:
            issues.append(f"hero '{name}' thiếu prefix")
            continue
        if pfx in seen_prefix:
            issues.append(f"prefix {pfx} trùng: {seen_prefix[pfx]} vs {name}")
        else:
            seen_prefix[pfx] = name

    # skin code trùng / lệch prefix
    code_owner: dict[str, str] = {}
    for key, code in skin_codes.items():
        hero = key.split("|", 1)[0] if "|" in key else "?"
        info = hero_data.get(hero) or {}
        pfx = str(info.get("prefix") or "")
        code_s = str(code)
        if pfx and not code_s.startswith(pfx):
            issues.append(f"skin code {code_s} không khớp prefix {pfx} ({key})")
        if code_s in code_owner and code_owner[code_s] != key:
            issues.append(f"skin code trùng {code_s}: {code_owner[code_s]} vs {key}")
        else:
            code_owner[code_s] = key

    # catalog vs skin_codes count
    for name, skins in catalog.items():
        if name not in hero_data:
            issues.append(f"catalog có '{name}' nhưng không có trong hero_data")
            continue
        for sn in skins:
            k = f"{name}|{sn}"
            if k not in skin_codes:
                issues.append(f"thiếu skin_codes cho {k}")

    # hero_data skins vs skin_codes
    for name, info in hero_data.items():
        for code in info.get("skins") or []:
            if str(code) not in code_owner:
                issues.append(f"{name}: skin {code} không map được tên")

    return issues


def compute_diff(out: dict) -> dict[str, Any]:
    """So sánh output mới với JSON hiện có trên disk."""
    old_cat = load_json(MINIBOT / "catalog.json") or {}
    old_codes = load_json(MINIBOT / "skin_codes.json") or {}
    old_data = load_json(MINIBOT / "hero_data_full.json") or {}

    new_cat: dict = out["catalog"]
    new_codes: dict = out["skin_codes"]
    new_data: dict = out["hero_data"]

    old_heroes = set(old_cat.keys()) | set(old_data.keys())
    new_heroes = set(new_cat.keys()) | set(new_data.keys())

    heroes_added = sorted(new_heroes - old_heroes)
    heroes_removed = sorted(old_heroes - new_heroes)

    skins_added = sorted(set(new_codes) - set(old_codes))
    skins_removed = sorted(set(old_codes) - set(new_codes))
    skins_changed = sorted(
        k for k in (set(new_codes) & set(old_codes))
        if str(new_codes[k]) != str(old_codes[k])
    )

    # prefix rename (cùng prefix, khác name)
    old_by_pfx = {
        str(v.get("prefix")): k
        for k, v in old_data.items()
        if isinstance(v, dict) and v.get("prefix") is not None
    }
    renames = []
    for name, info in new_data.items():
        pfx = str(info.get("prefix"))
        old_name = old_by_pfx.get(pfx)
        if old_name and old_name != name:
            renames.append(f"{old_name} → {name} (prefix {pfx})")

    return {
        "heroes_added": heroes_added,
        "heroes_removed": heroes_removed,
        "skins_added": skins_added,
        "skins_removed": skins_removed,
        "skins_changed": skins_changed,
        "renames": renames,
        "has_changes": bool(
            heroes_added or heroes_removed or skins_added
            or skins_removed or skins_changed or renames
        ),
    }


def list_orphan_sources(hero_data: dict) -> list[str]:
    """Folder Sources_Bot không còn trong hero_data (và không phải NON_HERO)."""
    if not SOURCES_BOT.is_dir():
        return []
    keep = set(hero_data.keys())
    orphans = []
    for d in os.listdir(SOURCES_BOT):
        p = SOURCES_BOT / d
        if not p.is_dir():
            continue
        if d in keep or d in NON_HERO_KEYS:
            continue
        orphans.append(d)
    return sorted(orphans)


def prune_orphan_sources(orphans: list[str], bad_map: dict[str, str] | None = None) -> list[str]:
    removed = []
    for name in orphans:
        # luôn cho phép xóa BAD_NAME_PREFIX; còn lại theo list orphans
        path = SOURCES_BOT / name
        if not path.is_dir():
            continue
        try:
            shutil.rmtree(path)
            removed.append(name)
        except Exception as exc:
            eprint(f"[warn] không xoá được Sources_Bot/{name}: {exc}")
    return removed


# ─── build ─────────────────────────────────────────────────────────────────

def build(
    id_file: Path,
    write_sources: bool = True,
    hero_filter: str | None = None,
    progress: bool = True,
) -> dict:
    if not id_file.is_file():
        raise FileNotFoundError(f"Không thấy {id_file}")

    folders = known_folder_names()
    parsed = parse_id_skinnn(id_file)

    if hero_filter:
        hf = hero_filter.strip().lower()
        parsed = [
            h for h in parsed
            if hf in (h.get("code") or "").lower()
            or hf == (h.get("prefix") or "")
            or hf in (h.get("internal") or "").lower()
            or any(hf in clean_skin_name(n).lower() for _, n in h.get("skins") or [])
        ]
        if not parsed:
            raise ValueError(f"--hero {hero_filter!r}: không khớp hero nào trong id file")

    hero_data: dict = {}
    hero_icons: dict = {
        "_note": "hero: {cdn}{prefix}0.jpg (301500.jpg). skin n>=1: {cdn}{prefix}{n}head.jpg (301501head.jpg).",
        "_cdn_id": CDN_ID,
        "_cdn_base": CDN_BASE,
        "_url_tpl_hero": CDN_BASE + "{cdn}{prefix}0.jpg",
        "_url_tpl_skin": CDN_BASE + "{cdn}{prefix}{variant}head.jpg",
        "_generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    skin_codes: dict = {}
    catalog: dict[str, list[str]] = {}

    empty_skin_heroes: list[str] = []
    forced_skip: list[str] = []
    map_log: list[str] = []
    notes: list[str] = []
    sources_written = 0
    sources_planned = 0
    used_names: dict[str, str] = {}  # name → prefix (chống trùng tên)
    dup_skin_names: list[str] = []
    total_h = len(parsed)
    done_h = 0

    for h in parsed:
        prefix = h["prefix"]
        skins = h["skins"]
        internal = h.get("internal") or ""
        if prefix in SKIP_PREFIXES:
            forced_skip.append(h.get("code") or prefix)
            done_h += 1
            if progress and total_h:
                ui.progress(done_h, total_h, f"skip {prefix}")
            continue

        name = resolve_hero_name(prefix, internal, skins, folders)
        if name in used_names and used_names[name] != prefix:
            name = f"{name}_{prefix}"
            notes.append(f"{h['code']} trùng tên → {name}")
        used_names[name] = prefix
        if name not in folders:
            folders.append(name)
            folders.sort(key=len, reverse=True)

        if not skins:
            empty_skin_heroes.append(f"{prefix} = {name}")
        map_log.append(
            f"{prefix} → {name}"
            + (f" ({internal})" if internal and internal != name else "")
        )

        hero_data[name] = {
            "prefix": prefix,
            "internal": internal,
            "skins": [code for code, _ in skins],
        }
        hero_icons[name] = {
            "cdn_id": CDN_ID,
            "prefix": prefix,
            "default_variant": 0,
            "api_key": f"{CDN_ID}_{prefix}0",
            "display_id": prefix,
        }

        skin_names: list[str] = []
        seen_names: set[str] = set()
        cleaned_skins: list[tuple[str, str]] = []
        for code, sname in skins:
            clean = clean_skin_name(sname)
            cleaned_skins.append((code, clean))
            key = f"{name}|{clean}"
            if clean in seen_names:
                # giữ code đầu; ghi nhận trùng tên
                prev = skin_codes.get(key)
                dup_skin_names.append(f"{key} (code {code}, giữ {prev})")
            else:
                seen_names.add(clean)
                skin_names.append(clean)
                skin_codes[key] = code
        catalog[name] = skin_names

        sources_planned += 1
        if write_sources:
            write_sources_bot(name, cleaned_skins)
            sources_written += 1

        done_h += 1
        if progress and total_h:
            ui.progress(done_h, total_h, name[:18])

    # dọn folder Sources_Bot tên sai (EX/Edras/…) nếu đã tạo bản đúng
    removed_bad: list[str] = []
    if write_sources:
        for bad, pfx in BAD_NAME_PREFIX.items():
            good = next(
                (n for n, info in hero_data.items() if info.get("prefix") == pfx),
                None,
            )
            bad_dir = SOURCES_BOT / bad
            if good and good != bad and bad_dir.is_dir():
                try:
                    shutil.rmtree(bad_dir)
                    removed_bad.append(bad)
                    notes.append(f"removed wrong Sources_Bot/{bad} (→ {good})")
                except Exception as exc:
                    notes.append(f"cannot remove Sources_Bot/{bad}: {exc}")

    # sort catalog alpha; hero_data giữ thứ tự parse (theo id file)
    catalog_sorted = {k: catalog[k] for k in sorted(catalog.keys(), key=lambda x: x.lower())}

    # nếu --hero filter: merge vào data cũ thay vì ghi đè toàn bộ
    if hero_filter:
        old_data = load_json(MINIBOT / "hero_data_full.json") or {}
        old_icons = load_json(MINIBOT / "hero_icons.json") or {}
        old_codes = load_json(MINIBOT / "skin_codes.json") or {}
        old_cat = load_json(MINIBOT / "catalog.json") or {}
        if isinstance(old_data, dict):
            merged_data = dict(old_data)
            merged_data.update(hero_data)
            hero_data = merged_data
        if isinstance(old_icons, dict):
            # giữ meta keys cũ, update hero entries + generated_at
            merged_icons = dict(old_icons)
            for k, v in hero_icons.items():
                if k.startswith("_") and k != "_generated_at":
                    continue
                merged_icons[k] = v
            merged_icons["_generated_at"] = hero_icons.get("_generated_at")
            if "_cdn_id" not in merged_icons:
                merged_icons["_cdn_id"] = CDN_ID
            hero_icons = merged_icons
        if isinstance(old_codes, dict):
            # xoá codes cũ của hero đang rebuild, rồi add mới
            for hn in catalog:
                old_codes = {k: v for k, v in old_codes.items() if not k.startswith(hn + "|")}
            old_codes.update(skin_codes)
            skin_codes = old_codes
        if isinstance(old_cat, dict):
            merged_cat = dict(old_cat)
            merged_cat.update(catalog_sorted)
            catalog_sorted = {
                k: merged_cat[k]
                for k in sorted(merged_cat.keys(), key=lambda x: x.lower())
            }

    orphans = list_orphan_sources(hero_data)

    result = {
        "hero_data": hero_data,
        "hero_icons": hero_icons,
        "skin_codes": skin_codes,
        "catalog": catalog_sorted,
        "stats": {
            "id_file": str(id_file),
            "heroes_src": len(parsed) if not hero_filter else len(parse_id_skinnn(id_file)),
            "heroes_parsed": len(parsed),
            "heroes_out": len(hero_data),
            "skins": len(skin_codes),
            "catalog_heroes": len(catalog_sorted),
            "sources_written": sources_written,
            "sources_planned": sources_planned,
            "empty_skin_heroes": empty_skin_heroes,
            "forced_skip": forced_skip,
            "map_log": map_log,
            "notes": notes,
            "dup_skin_names": dup_skin_names,
            "removed_bad_folders": removed_bad,
            "orphan_sources": orphans,
            "hero_filter": hero_filter,
        },
    }
    result["issues"] = validate_build(result)
    return result


# ─── CLI print ─────────────────────────────────────────────────────────────

def print_diff(diff: dict, verbose: bool = False, limit: int = 30) -> None:
    ui.section("DIFF")
    if not diff.get("has_changes"):
        ui.ok("Không có thay đổi so với JSON hiện tại")
        return
    pairs = [
        ("Hero mới", diff["heroes_added"]),
        ("Hero xoá", diff["heroes_removed"]),
        ("Skin mới", diff["skins_added"]),
        ("Skin xoá", diff["skins_removed"]),
        ("Skin đổi code", diff["skins_changed"]),
        ("Đổi tên", diff["renames"]),
    ]
    for label, items in pairs:
        if not items:
            continue
        ui.kv(label, len(items), "Δ")
        show = items if verbose else items[:limit]
        for s in show:
            ui.info(str(s))
        if not verbose and len(items) > limit:
            ui.warn(f"+{len(items) - limit} nữa (dùng -v)")


def print_report(out: dict, *, verbose: bool = False, quiet: bool = False) -> None:
    st = out["stats"]
    if quiet:
        print(
            f"heroes={st['heroes_out']} skins={st['skins']} "
            f"issues={len(out.get('issues') or [])} sources={st['sources_written']}"
        )
        return

    ui.section("THỐNG KÊ")
    ui.kv("id file", st["id_file"], "📄")
    if st.get("hero_filter"):
        ui.kv("filter", f"{st['hero_filter']} (parsed {st['heroes_parsed']})", "🔍")
    ui.kv("Heroes src", st["heroes_src"], "📥")
    ui.kv("Heroes out", st["heroes_out"], "📤")
    ui.kv("Skins", st["skins"], "🎨")
    ui.kv("Catalog", st["catalog_heroes"], "📚")
    planned = st.get("sources_planned", st["sources_written"])
    if st["sources_written"]:
        ui.kv("Sources_Bot", f"{st['sources_written']} folder written", "📁")
    else:
        ui.kv("Sources_Bot", f"{planned} folder (planned)", "📁")

    if st.get("forced_skip"):
        ui.section("BỎ QUA")
        ui.warn(", ".join(st["forced_skip"]))

    if st.get("empty_skin_heroes"):
        ui.section(f"CHƯA CÓ SKIN ({len(st['empty_skin_heroes'])})")
        for s in st["empty_skin_heroes"]:
            ui.info(s)

    if st.get("dup_skin_names"):
        ui.section(f"TRÙNG TÊN SKIN ({len(st['dup_skin_names'])})")
        for s in st["dup_skin_names"][:20]:
            ui.warn(s)

    if st.get("orphan_sources"):
        ui.section(f"SOURCES ORPHAN ({len(st['orphan_sources'])})")
        ui.warn(", ".join(st["orphan_sources"][:15])
                + ("…" if len(st["orphan_sources"]) > 15 else ""))
        ui.info("Xoá bằng --prune-sources")

    check = [
        s for s in st.get("map_log") or []
        if re.match(r"^(159|194|577|593|595|582|584)\b", s)
    ]
    if check:
        ui.section("CHECK ID → TÊN")
        for s in check:
            ui.info(s)

    notes = st.get("notes") or []
    if notes:
        ui.section(f"NOTES ({len(notes)})")
        for s in notes[:30]:
            ui.info(s)

    issues = out.get("issues") or []
    ui.section("VALIDATE")
    if issues:
        ui.err(f"{len(issues)} issue(s)")
        for s in issues[:40]:
            ui.err(s)
        if len(issues) > 40:
            ui.warn(f"+{len(issues) - 40}")
    else:
        ui.ok("OK — không phát hiện lỗi")

    if verbose:
        ui.section(f"MAP LOG ({len(st.get('map_log') or [])})")
        for s in st.get("map_log") or []:
            ui.info(s)


def print_sample_urls() -> None:
    ui.section("URL MẪU · Airi (prefix 130)")
    ui.kv("display", "130")
    ui.kv("hero", f"{CDN_BASE}{CDN_ID}1300.jpg")
    ui.kv("skin 01", f"{CDN_BASE}{CDN_ID}1301head.jpg")
    ui.kv("skin 09", f"{CDN_BASE}{CDN_ID}1309head.jpg")


# ─── main ──────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    global ui

    ap = argparse.ArgumentParser(
        description="Sync minibot JSON + Sources_Bot skins from id_skinnn.txt",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Ví dụ:\n"
            "  py minibot/build_hero_data.py\n"
            "  py minibot/build_hero_data.py --dry-run --diff -v\n"
            "  py minibot/build_hero_data.py --check\n"
            "  py minibot/build_hero_data.py --backup --no-sources\n"
            "  py minibot/build_hero_data.py --hero Airi\n"
            "  py minibot/build_hero_data.py --prune-sources\n"
            "  py minibot/build_hero_data.py --no-pause   # thoát ngay (CI)\n"
        ),
    )
    ap.add_argument("--id-file", default=None, help="Path to id_skinnn.txt (auto-detect nếu bỏ trống)")
    ap.add_argument("--dry-run", action="store_true", help="Không ghi file")
    ap.add_argument("--no-sources", action="store_true", help="Không ghi Sources_Bot (chỉ JSON minibot)")
    ap.add_argument("--diff", action="store_true", help="In diff so với JSON hiện tại")
    ap.add_argument("--check", action="store_true", help="Chỉ validate (implied dry-run), exit 1 nếu lỗi")
    ap.add_argument("--backup", action="store_true", help="Backup JSON cũ trước khi ghi")
    ap.add_argument("--prune-sources", action="store_true",
                    help="Xoá folder Sources_Bot không còn trong hero_data")
    ap.add_argument("--hero", default=None, help="Chỉ rebuild 1 hero (tên/prefix/internal), merge vào JSON cũ")
    ap.add_argument("--sync-id-copy", action="store_true",
                    help="Copy id file vào minibot/id_skinnn.txt")
    ap.add_argument("--report", default=None, metavar="PATH",
                    help="Ghi report JSON (stats + issues + diff)")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("-q", "--quiet", action="store_true")
    ap.add_argument("--no-pause", action="store_true",
                    help="Thoát ngay khi xong (mặc định: chờ Enter nếu chạy interactive)")
    ap.add_argument("--pause", action="store_true",
                    help="Luôn chờ Enter khi xong (kể cả non-TTY)")
    ap.add_argument("--no-color", action="store_true", help="Tắt màu ANSI")
    args = ap.parse_args(argv)

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    # title bar Windows
    if os.name == "nt":
        try:
            os.system("title BANNEI · build_hero_data")
        except Exception:
            pass

    color_on = not args.no_color and os.environ.get("NO_COLOR") is None
    ui = UI(enabled=color_on, quiet=args.quiet)
    ui.banner(
        "BANNEI · BUILD HERO DATA",
        "sync skin · icon · catalog · Sources_Bot",
    )

    try:
        id_file = resolve_id_file(args.id_file)
    except FileNotFoundError as exc:
        ui.err(str(exc))
        return 2

    write_sources = not args.no_sources and not args.check
    dry_run = args.dry_run or args.check

    mode_bits = []
    if dry_run:
        mode_bits.append("DRY-RUN")
    if args.check:
        mode_bits.append("CHECK")
    if args.no_sources:
        mode_bits.append("NO-SOURCES")
    if args.hero:
        mode_bits.append(f"HERO={args.hero}")
    if args.backup:
        mode_bits.append("BACKUP")
    if args.prune_sources:
        mode_bits.append("PRUNE")
    ui.step(1, 4, "Chuẩn bị")
    ui.kv("mode", " · ".join(mode_bits) if mode_bits else "FULL WRITE")
    ui.kv("id file", id_file)

    ui.step(2, 4, "Parse + build…")
    try:
        out = build(
            id_file,
            write_sources=write_sources and not dry_run,
            hero_filter=args.hero,
            progress=not args.quiet,
        )
    except Exception as exc:
        ui.err(f"Build failed: {exc}")
        if args.verbose:
            raise
        return 2

    if args.no_sources:
        out["stats"]["sources_planned"] = 0

    ui.step(3, 4, "Báo cáo")
    diff = compute_diff(out)
    print_report(out, verbose=args.verbose, quiet=args.quiet)
    if args.diff or args.verbose:
        print_diff(diff, verbose=args.verbose)

    issues = out.get("issues") or []
    if args.report:
        report = {
            "stats": out["stats"],
            "issues": issues,
            "diff": diff,
            "ok": not issues,
        }
        rpath = Path(args.report)
        rpath.parent.mkdir(parents=True, exist_ok=True)
        rpath.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        ui.ok(f"Report → {rpath}")

    st = out["stats"]
    status = "OK" if not issues else f"WARN · {len(issues)} issue(s)"

    if args.check:
        ui.summary_box(
            [
                ("Heroes", str(st["heroes_out"])),
                ("Skins", str(st["skins"])),
                ("Issues", str(len(issues))),
                ("Status", "PASS" if not issues else "FAIL"),
            ],
            footer="check-only · không ghi file",
        )
        if issues:
            ui.err(f"--check failed: {len(issues)} issue(s)")
            return 1
        return 0

    if dry_run:
        ui.summary_box(
            [
                ("Heroes", str(st["heroes_out"])),
                ("Skins", str(st["skins"])),
                ("Diff", "có thay đổi" if diff.get("has_changes") else "không đổi"),
                ("Status", status),
            ],
            footer="dry-run · không ghi file",
        )
        return 0

    ui.step(4, 4, "Ghi file…")
    files = {
        MINIBOT / "hero_data_full.json": out["hero_data"],
        MINIBOT / "hero_icons.json": out["hero_icons"],
        MINIBOT / "skin_codes.json": out["skin_codes"],
        MINIBOT / "catalog.json": out["catalog"],
    }

    if args.backup:
        bdir = backup_outputs(list(files.keys()))
        if bdir:
            try:
                rel_b = bdir.relative_to(ROOT)
            except ValueError:
                rel_b = bdir
            ui.ok(f"Backup → {rel_b}")

    wrote = []
    for path, data in files.items():
        size = atomic_write_json(path, data)
        try:
            rel = path.relative_to(ROOT)
        except ValueError:
            rel = path
        wrote.append(f"{rel} ({size:,} B)")
        ui.ok(f"Wrote {rel} ({size:,} bytes)")

    if args.sync_id_copy:
        dest = MINIBOT / "id_skinnn.txt"
        if id_file.resolve() != dest.resolve():
            shutil.copy2(id_file, dest)
            try:
                ui.ok(f"Copied id → {dest.relative_to(ROOT)}")
            except ValueError:
                ui.ok(f"Copied id → {dest}")

    pruned_n = 0
    if args.prune_sources:
        orphans = out["stats"].get("orphan_sources") or []
        if args.hero:
            ui.warn("bỏ qua --prune-sources khi dùng --hero")
        elif orphans:
            removed = prune_orphan_sources(orphans)
            pruned_n = len(removed)
            ui.ok(f"Pruned Sources_Bot: {pruned_n} folder")
            for n in removed:
                ui.info(n)
        else:
            ui.ok("Không có Sources_Bot orphan")

    print_sample_urls()
    ui.info("Sau khi sửa id_skinnn.txt → chạy lại lệnh này.")
    if issues:
        ui.warn(f"Vẫn còn {len(issues)} issue — kiểm tra bằng --check / -v")

    ui.summary_box(
        [
            ("Heroes", str(st["heroes_out"])),
            ("Skins", str(st["skins"])),
            ("JSON files", str(len(wrote))),
            ("Sources_Bot", str(st["sources_written"])),
            ("Pruned", str(pruned_n)),
            ("Status", status),
        ],
        footer="ghi xong · sẵn sàng deploy Mini App",
    )
    return 0


def _should_pause(args: argparse.Namespace) -> bool:
    if args.no_pause or args.quiet:
        return False
    if args.pause:
        return True
    # mặc định: pause khi chạy interactive (double-click / console tay)
    try:
        return sys.stdin.isatty() and sys.stdout.isatty()
    except Exception:
        return True


if __name__ == "__main__":
    _code = 1
    _args_for_pause = None
    try:
        # pre-parse chỉ để biết pause flags nếu main crash sớm
        _pre = argparse.ArgumentParser(add_help=False)
        _pre.add_argument("--no-pause", action="store_true")
        _pre.add_argument("--pause", action="store_true")
        _pre.add_argument("-q", "--quiet", action="store_true")
        _args_for_pause, _ = _pre.parse_known_args()
        _code = main()
    except KeyboardInterrupt:
        print("\n  ⚠ Đã huỷ (Ctrl+C)")
        _code = 130
    except Exception as _exc:
        print(f"\n  ✖ Lỗi không xử lý: {_exc}", file=sys.stderr)
        _code = 1
    finally:
        try:
            if _args_for_pause is not None and _should_pause(_args_for_pause):
                ui.pause(_code)
            elif _args_for_pause is not None and getattr(_args_for_pause, "pause", False):
                try:
                    input("  Nhấn Enter để đóng… ")
                except Exception:
                    pass
        except Exception:
            # fallback cứng: vẫn cố giữ cửa sổ
            if sys.stdin.isatty():
                try:
                    input("\n  Nhấn Enter để đóng… ")
                except Exception:
                    pass
    raise SystemExit(_code)
