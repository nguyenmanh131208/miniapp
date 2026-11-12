# -*- coding: utf-8 -*-
"""
bot.py - Telegram Bot Backend cho BANNEI MOD LQ Mini App
Tich hop tu dong voi kho tai nguyen Resources/1.64.1
"""

import os
import io
import json
import zipfile
import logging
from pathlib import Path
from telegram import (
    Update,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
    MenuButtonWebApp,
)
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    filters,
    ContextTypes,
)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

CURRENT_DIR = Path(__file__).resolve().parent

# --- DOC CAU HINH ---
def load_config() -> dict:
    candidates = (
        CURRENT_DIR / "config.json",
        CURRENT_DIR / "config" / "config.json",
    )
    for path in candidates:
        if path.is_file():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Loi khi doc {path}: {e}")
    return {}

config = load_config()
BOT_TOKEN = config.get("BOT_TOKEN", "YOUR_BOT_TOKEN_HERE")
WEBAPP_URL = config.get("WEBAPP_URL", "https://your-deployed-app.pages.dev/")
ADMIN_ID = int(config.get("ADMIN_ID", 2056107378))

# --- DOC DATA CATALOG & SKIN CODES ---
def load_json_data(file_name: str) -> dict:
    path = CURRENT_DIR / file_name
    if path.is_file():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Loi doc {file_name}: {e}")
    return {}

SKIN_CODES = load_json_data("skin_codes.json")
HERO_DATA = load_json_data("hero_data_full.json")

# Phat hien phien ban game tu thu muc Resources
def detect_game_version() -> str:
    res_dir = CURRENT_DIR / "Resources"
    if res_dir.is_dir():
        for child in res_dir.iterdir():
            if child.is_dir() and child.name[0].isdigit():
                return child.name
    return "1.64.1"

GAME_VERSION = detect_game_version()
RES_BASE = CURRENT_DIR / "Resources" / GAME_VERSION

# Danh sach cac ma skin Thu Nguyen Ve Than (Dimension Breakers)
DIMENSION_SKIN_CODES = frozenset({"13015", "13215", "13314", "14115", "15015", "50114"})


def process_action_swap(orig_actions_path: Path, skin_code: str, prefix: str) -> bytes:
    """
    Trao doi file action (chieu thuc, bien ve, imprint) cua skin VIP
    vao cac slot action mac dinh trong Actor_Actions.pkg.bytes
    """
    try:
        with open(orig_actions_path, "rb") as f:
            in_buf = io.BytesIO(f.read())
        
        in_zip = zipfile.ZipFile(in_buf, "r")
        out_buf = io.BytesIO()
        out_zip = zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED)

        vip_files = {}
        for name in in_zip.namelist():
            if skin_code in name:
                base = name.split("/")[-1].lower()
                folder = "/".join(name.split("/")[:-1])
                content = in_zip.read(name)

                if "back" in base:
                    vip_files[f"{folder}/Back.xml"] = content
                    vip_files[f"{folder}/{prefix}_Back.xml"] = content
                elif "imprint" in base:
                    vip_files[f"{folder}/Imprint.xml"] = content
                elif "skill" in folder.lower() and not base.startswith("playanim"):
                    vip_files[f"{folder}/S1.xml"] = content
                    vip_files[f"{folder}/S2.xml"] = content
                    vip_files[f"{folder}/S3.xml"] = content

        for item in in_zip.infolist():
            if item.filename in vip_files:
                out_zip.writestr(item.filename, vip_files[item.filename])
            else:
                out_zip.writestr(item, in_zip.read(item.filename))

        for vname, vdata in vip_files.items():
            if vname not in in_zip.namelist():
                out_zip.writestr(vname, vdata)

        in_zip.close()
        out_zip.close()
        return out_buf.getvalue()
    except Exception as e:
        logger.error(f"Loi khi trao action cho hero {prefix}: {e}")
        return orig_actions_path.read_bytes()


def create_mod_zip_package(items: dict) -> io.BytesIO:
    """
    Dong goi file zip chua toan bo tai nguyen game tu Resources/1.64.1
    """
    buffer = io.BytesIO()
    
    server_dir = items.get("Server", "Resources")
    pkg_map = {
        "Resources": "com.garena.game.kgvn",
        "Resources_TH": "com.garena.game.kgth",
        "Resources_TW": "com.garena.game.kgtw",
        "Resources_EU": "com.levelinfinite.sgameGlobal",
    }
    target_package = pkg_map.get(server_dir, "com.garena.game.kgvn")

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        readme_lines = [
            "=================================================",
            "BANNEI MOD LQ - GOI MOD PHIEN BAN " + GAME_VERSION,
            "=================================================",
            "",
            "DANH SACH MOD DA CHON:",
        ]

        has_dimension = False

        for key, val in items.items():
            if key == "Server":
                continue

            readme_lines.append(f"  - {key}: {val}")

            # 1. Cam Xa
            if key == "Cam Xa":
                cam_path = RES_BASE / "Camera" / "Skill" / "SkillCamera.pkg.bytes"
                if cam_path.is_file():
                    zf.write(cam_path, arcname=f"files/Resources/{GAME_VERSION}/Camera/Skill/SkillCamera.pkg.bytes")

            # 2. HD Chieu
            elif key == "HD Chiêu":
                hd_path = RES_BASE / "Config" / "ParticleLimit.txt"
                if hd_path.is_file():
                    zf.write(hd_path, arcname=f"files/Resources/{GAME_VERSION}/Config/ParticleLimit.txt")

            # 3. Skin Tuong
            else:
                hero_name = key
                skin_name = val
                hero_info = HERO_DATA.get(hero_name, {})
                prefix = hero_info.get("prefix")
                skin_code = SKIN_CODES.get(f"{hero_name}|{skin_name}", "")

                if not prefix:
                    continue

                if skin_code in DIMENSION_SKIN_CODES:
                    has_dimension = True

                # File Model Infos
                info_path = RES_BASE / "Prefab_Characters" / f"Actor_{prefix}_Infos.pkg.bytes"
                if info_path.is_file():
                    zf.write(info_path, arcname=f"files/Resources/{GAME_VERSION}/Prefab_Characters/Actor_{prefix}_Infos.pkg.bytes")

                # File Asset References
                ref_path = RES_BASE / "AssetRefs" / "Hero" / f"{prefix}_AssetRef.bytes"
                if ref_path.is_file():
                    zf.write(ref_path, arcname=f"files/Resources/{GAME_VERSION}/AssetRefs/Hero/{prefix}_AssetRef.bytes")

                # File Action trao doi chiêu & bien ve
                act_path = RES_BASE / "Ages" / "Prefab_Characters" / "Prefab_Hero" / f"Actor_{prefix}_Actions.pkg.bytes"
                if act_path.is_file():
                    if skin_code:
                        swapped_data = process_action_swap(act_path, skin_code, prefix)
                        zf.writestr(f"files/Resources/{GAME_VERSION}/Ages/Prefab_Characters/Prefab_Hero/Actor_{prefix}_Actions.pkg.bytes", swapped_data)
                    else:
                        zf.write(act_path, arcname=f"files/Resources/{GAME_VERSION}/Ages/Prefab_Characters/Prefab_Hero/Actor_{prefix}_Actions.pkg.bytes")

        # Neu co skin Thu Nguyen Ve Than: Nap Rong, Quai duong rong va Buff bien hinh
        if has_dimension:
            monster_age = RES_BASE / "Ages" / "Prefab_Characters" / "Prefab_Monster_Age.pkg.bytes"
            if monster_age.is_file():
                zf.write(monster_age, arcname=f"files/Resources/{GAME_VERSION}/Ages/Prefab_Characters/Prefab_Monster_Age.pkg.bytes")

            dim_cfg = RES_BASE / "Databin" / "Client" / "Actor" / "ResDimensionHeroCfg.bytes"
            if dim_cfg.is_file():
                zf.write(dim_cfg, arcname=f"files/Resources/{GAME_VERSION}/Databin/Client/Actor/ResDimensionHeroCfg.bytes")

            dim_battle = RES_BASE / "Databin" / "Client" / "Actor" / "ResDimensionPartBattle.bytes"
            if dim_battle.is_file():
                zf.write(dim_battle, arcname=f"files/Resources/{GAME_VERSION}/Databin/Client/Actor/ResDimensionPartBattle.bytes")

        readme_lines.extend([
            "",
            "CAC BUOC CAI DAT TREN ANDROID:",
            "1. Mo ZArchiver, tim file zip vua tai ve.",
            "2. Giai nen lay thu muc 'files'.",
            f"3. Chep de thu muc 'files' vao duong dan:",
            f"   Android/data/{target_package}/",
            "4. Chon 'Ghi de tat ca' khi duoc hoi.",
            "5. Vao game de trai nghiem skin moi.",
            "",
            "LUU Y: De quay ve trang phuc goc, vao Cai dat trong game chon 'Tu sua chua file'.",
        ])

        zf.writestr("files/HUONG_DAN_CAI_DAT.txt", "\r\n".join(readme_lines).encode("utf-8"))

    buffer.seek(0)
    return buffer


async def set_bot_menu_button(context: ContextTypes.DEFAULT_TYPE, chat_id: int):
    try:
        await context.bot.set_chat_menu_button(
            chat_id=chat_id,
            menu_button=MenuButtonWebApp(
                text="Mod Skin",
                web_app=WebAppInfo(url=WEBAPP_URL),
            ),
        )
    except Exception as e:
        logger.warning(f"Khong the set menu button: {e}")


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    chat_id = update.effective_chat.id
    logger.info(f"User {user.id} ({user.first_name}) gui lenh /start")

    await set_bot_menu_button(context, chat_id)

    kb = [
        [
            KeyboardButton(
                text="Mo Mini App Mod Skin",
                web_app=WebAppInfo(url=WEBAPP_URL),
            )
        ]
    ]
    reply_markup = ReplyKeyboardMarkup(kb, resize_keyboard=True)

    welcome_text = (
        f"Xin chao {user.first_name}!\n\n"
        f"He thong Mod Skin Lien Quan (Phien ban game: {GAME_VERSION}).\n"
        "Bam nut 'Mo Mini App Mod Skin' ben duoi hoac nut Menu o goc trai de bat dau chon trang phuc."
    )
    await update.message.reply_text(welcome_text, reply_markup=reply_markup)


async def handle_webapp_data(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    raw_data = update.effective_message.web_app_data.data
    logger.info(f"Du lieu nhan duoc tu {user.id}: {raw_data}")

    try:
        payload = json.loads(raw_data)
    except Exception as e:
        logger.error(f"Loi doc JSON tu WebApp: {e}")
        await update.message.reply_text("Loi: Du lieu gui tu Mini App khong hop le.")
        return

    req_type = payload.get("type")

    # 1. YEU CAU MOD SKIN
    if req_type == "chaymod":
        items = payload.get("items", {})
        if not items:
            await update.message.reply_text("Gio hang cua ban dang trong. Vui long chon skin truoc khi chay.")
            return

        detail_lines = [f"Da nhan yeu cau mod (Phien ban: {GAME_VERSION}):"]
        for k, v in items.items():
            detail_lines.append(f"- {k}: {v}")
        detail_lines.append("\nDang trich xuat asset va dong goi file mod, vui long cho trong giay lat...")

        status_msg = await update.message.reply_text("\n".join(detail_lines))

        # Tao file zip voi data thuc te tu Resources/1.64.1
        zip_buffer = create_mod_zip_package(items)

        filename = f"ModSkin_{user.id}_{GAME_VERSION}.zip"
        caption = (
            f"Tao file mod thanh cong (Game v{GAME_VERSION})!\n\n"
            "Cach cai:\n"
            "1. Tai file zip ve may.\n"
            "2. Giai nen thu muc 'files'.\n"
            "3. Chep de vao: Android/data/com.garena.game.kgvn/"
        )
        await update.message.reply_document(
            document=zip_buffer,
            filename=filename,
            caption=caption,
        )

        try:
            await status_msg.delete()
        except Exception:
            pass

    # 2. YEU CAU ADMIN
    elif req_type == "admin":
        if user.id != ADMIN_ID:
            await update.message.reply_text("Tu choi: Ban khong co quyen Admin.")
            return

        action = payload.get("action")
        args = payload.get("args", {})
        logger.info(f"Admin action: {action} - args: {args}")

        resp_text = f"[Admin System]\nDa thuc hien lenh: {action}\nTham so: {json.dumps(args, ensure_ascii=False)}"
        await update.message.reply_text(resp_text)


def main():
    if not BOT_TOKEN or BOT_TOKEN == "YOUR_BOT_TOKEN_HERE":
        print("-------------------------------------------------------")
        print("Loi: Vui long dien BOT_TOKEN vao file config.json.")
        print("Mo file config.json va thay YOUR_BOT_TOKEN_HERE bang Token lay tu @BotFather.")
        print("-------------------------------------------------------")
        return

    print(f"Khoi dong Bot Telegram (Phien ban game nhan dien: {GAME_VERSION})...")
    app = ApplicationBuilder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("webapp", start_command))
    app.add_handler(
        MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_webapp_data)
    )

    print("Bot da san sang nhan tin nhan tu Telegram!")
    app.run_polling()


if __name__ == "__main__":
    main()
