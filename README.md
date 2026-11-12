# BANNEI MOD LQ — Telegram Mini App · Liquid Glass 6.0

UI mới (liquid glass / glassmorphism premium) + animation 60fps + Telegram login + Admin panel full quyền.

## Cấu trúc

```
minibot/
├── index.html       # giao diện (5 tabs: Tướng · Bổ trợ · Giỏ · Khác · Admin)
├── styles.css       # liquid glass tokens + spring animations
├── app.js           # logic: login, catalog, cart, admin, settings
└── catalog.json     # data {folder: [skin_names]} — auto-gen từ Sources_Bot/
```

## Tính năng

### User
- 🎭 **Tướng** — chọn theo chữ cái + search realtime tướng/skin
- 🛠️ **Bổ trợ** — Cam Xa (105–295%), HD Chiêu, MOD ROV, Nút Bấm
- 🛒 **Giỏ** — review + 1 tap Chạy Mod, badge VIP nếu có
- ⚙️ **Khác** — check VIP, copy ID, toggle haptic/confetti, donate, reset

### Admin (auto-detect ID `2056107378`)
- 💎 Cấp VIP / Cộng VIP toàn server / List / Tước VIP / Reset ALL
- 🚫 Ban / 🔓 Unban
- 🔑 Bật/Tắt/Status chế độ Key
- 📣 Broadcast guiall

### Animation
- Aurora gradient mesh + animated blobs
- Layered glass refraction, edge highlights, sheen sweep
- Spring `cubic-bezier(.34,1.56,.64,1)` cho tap
- Ripple, confetti, rocket-ring on run, stagger pop-in
- Haptic feedback mọi tương tác (Telegram SDK)
- BackButton tự ẩn/hiện theo sub-pane

## Build / Deploy (3 bước)

### 1) Sync skin từ id_skinnn.txt
```bash
py minibot/build_hero_data.py
```
Đọc `id_skinnn.txt` (auto: root → minibot → cwd) → cập nhật:
- `catalog.json` (UI list skin)
- `hero_data_full.json`, `hero_icons.json`, `skin_codes.json`
- `Sources_Bot/<hero>/gốc.txt` + `sources.txt` (bot chaymod)

Icon CDN:
- **Hero** (default): `301500.jpg` — `{cdn}{prefix}0.jpg`
- **Skin** (id ≥ 1): `301501head.jpg` — `{cdn}{prefix}{n}head.jpg`

Lệnh hữu ích:
```bash
py minibot/build_hero_data.py                       # full sync (chờ Enter khi xong)
py minibot/build_hero_data.py --no-sources          # chỉ JSON minibot
py minibot/build_hero_data.py --dry-run --diff -v   # xem thay đổi, không ghi
py minibot/build_hero_data.py --check               # validate (exit 1 nếu lỗi)
py minibot/build_hero_data.py --backup              # backup JSON trước khi ghi
py minibot/build_hero_data.py --hero Airi           # rebuild 1 tướng (merge)
py minibot/build_hero_data.py --prune-sources       # xoá folder Sources_Bot orphan
py minibot/build_hero_data.py --sync-id-copy        # copy id_skinnn vào minibot/
py minibot/build_hero_data.py --no-pause            # thoát ngay (CI / script)
```
Hoặc double-click `minibot/build_hero_data.bat` — cửa sổ **không tự đóng** (chờ Enter).
Mỗi lần thêm/xoá skin trong `id_skinnn.txt` → chạy lại.

### 2) Push GitHub Pages
```bash
cd minibot
git init && git add . && git commit -m "init mini app"
git remote add origin git@github.com:<USER>/bannei-modlq-webapp.git
git push -u origin main
```
**Settings → Pages → Source: main / root → Save** → copy URL.

### 3) Cấu hình bot
Sửa `config/config.json`:
```json
{
  "BOT_TOKEN": "...",
  "WEBAPP_URL": "https://<user>.github.io/bannei-modlq-webapp/"
}
```
Khởi động lại bot:
```bash
py bot.py
```

## Sử dụng

**User**:
- `/start` → bot auto-set Menu Button ☰ → bấm để mở Mini App
- Hoặc `/webapp` → bấm nút **🚀 Mở Mini App — Liquid Glass**
- Chọn tướng → skin → bổ trợ → **Chạy Mod** → bot xử lý

**Telegram login**: auto. Mini App đọc `Telegram.WebApp.initDataUnsafe.user` cho avatar/tên/ID. VIP days + admin flag được bot encode qua `?s=vip:N+admin:1` mỗi lần mở.

**Admin**: nếu user.id = ADMIN → tab 👑 Admin xuất hiện tự động.

## Lưu ý

- HTTPS bắt buộc (GitHub Pages mặc định có)
- `sendData()` chỉ work khi mở qua **Reply Keyboard Button** hoặc **Menu Button** — KHÔNG work với inline button. Cả `/webapp` lẫn menu button đều ổn
- Bot dùng `MessageHandler(filters.StatusUpdate.WEB_APP_DATA)` để parse payload
- Theme auto đổi sáng/tối theo Telegram (CSS vars + body class `tg-light`)
- Catalog static — search/list client-side, không hit bot
- Cart + settings persist trong `localStorage`

## Payload contract (sendData JSON)

**chaymod**:
```json
{ "type": "chaymod", "items": {"Airi": "Airi Mỵ hồ", "HD Chiêu": "HD"}, "ts": 1717... }
```

**admin**:
```json
{ "type": "admin", "action": "vipmember", "args": {"user_id":"123","days":"30"}, "ts": 1717... }
```

Actions: `vipmember | congvipall | listvip | resetvip | resetvipall | ban | unban | batkey | tatkey | statuskey | guiall`
