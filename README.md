# Haveli: hotel management

Bookings, rooms, guests, payments and a daily dashboard for a hotel. The data lives in a **Google Sheet the hotel owns**; the app reads and writes it. Works on a laptop, tablet and phone, in a dark (default) or light **Clay & Sand** look.

**Try it first, no setup:** `npm install`, then `npm run dev:demo`. Made-up data, nothing is saved.

Contents: [Features](#features) · [Set up](#set-up) · [Use it from anywhere](#use-it-from-anywhere-phone-tablet-any-browser) · [Daily use](#daily-use) · [Sheet tabs](#sheet-tabs) · [Project structure](#project-structure) · [Commands](#commands) · [Troubleshooting](#troubleshooting) · [Selling it](#selling-it-to-hotels-and-franchises)

## Features

- **Bookings** on a board (Reserved → Checked in → Checked out, or Cancelled), several rooms per booking, discount in ₹ or %, edit after saving, double booking blocked.
- **Payments and refunds** in a ledger; the dashboard shows money actually received.
- **Every person has their own login.** The owner adds employees; the owner password opens any employee's account (recorded as "Name (via owner)"). Every booking and payment records who took it.
- **The hotel's own name** is the logo on the sidebar, sign-in screen, welcome animation and browser tab. It is set in `.env` (`HOTEL_NAME`), so each hotel that buys the app sees its own name.
- **Dark / light** switch beside the bell; each person's choice is remembered.
- **Website background** (owner only, same for everyone): plain, a drawn hotel scene, a photo (up to 5 MB) or a looping video (15 seconds or less, up to 20 MB).
- **The Google Sheet is styled too** (header, banded rows, colours for stages and room status, dropdowns, ₹ formats). It is applied by **Settings → Set up sheet**, which never changes a value.
- Runs on your own computer or on the web, so the owner can open it from any device.

## Set up

You need **Node.js 20 or newer** (https://nodejs.org, "LTS"), a terminal, and a Google account that owns the sheet.

### 1. Google Sheet and key (once, about 10 minutes)

The app signs in to Google as a small robot account (a service account) that you share your sheet with.

1. Create a blank Google Sheet and leave it empty.
2. At https://console.cloud.google.com create a project, then **APIs & Services → Library → Google Sheets API → Enable**.
3. **IAM & Admin → Service accounts → Create service account** (name it e.g. "haveli") → **Done**.
4. Open it → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. **It is a password: keep it private.**
5. Copy `client_email` from that file, press **Share** on your sheet, paste it, choose **Editor**.

### 2. Fill in `.env`

Run `npm run setup`. It asks a few questions, checks the Google connection and writes `.env`. (`npm run setup -- --check` tests an existing `.env`.)

Or copy `.env.example` to `.env` and fill in by hand:

| Setting | Meaning |
|---|---|
| `SHEET_ID` | The sheet's address, or the long id between `/d/` and `/edit`. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The whole downloaded key file, pasted inside single quotes. |
| `OWNER_PASSWORD` | The owner's password (8+ characters; **12+ if the app is on the internet**). |
| `SESSION_SECRET` | Long random text (24+ characters): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `HOTEL_NAME` | **The hotel's name**, shown as the logo everywhere. Restart after changing it. |
| `OWNER_USERNAME`, `OWNER_NAME`, `HOTEL_TIMEZONE` | Optional. Defaults: `owner`, `Owner`, `Asia/Kolkata`. |
| `PORT`, `HOST`, `TRUST_PROXY`, `MEDIA_DIR` | Optional, for running on the web: see the next section. |

`.env` is ignored by git. If the key ever leaks, delete it in Google Cloud and create a new one.

### 3. Run

```bash
npm install
npm run dev              # development, http://localhost:5173
```

```bash
npm run build            # everyday use: build once...
npm start                # ...then http://localhost:3000
```

**First sign-in:** user `owner` + the owner password → **Settings** → **Set up sheet** → **Quick room setup** → **Add employee** for each person.
The app re-reads the sheet every 45 seconds, so edits made directly in Google Sheets show up by themselves.

## Use it from anywhere (phone, tablet, any browser)

By default the app listens on this computer only. To let the owner open it from any device, it must be reachable at an **https address**. Three ways, easiest first. Whichever you pick, the rules are the same:

- **Use HTTPS only.** Over plain http, passwords travel readable. Never open the port to the internet directly.
- **Use a long owner password** (12+ characters). The server warns at start if it is short.
- **Run exactly one copy** of the app per sheet.
- Set `TRUST_PROXY=1` when a host, tunnel or proxy sits in front (it makes sign-in limits and the secure cookie work on the visitor's real address). Hosting services below are detected automatically.
- `GET /health` answers `ok` with no sign-in, for uptime checks.
- The background file lives in `media/` (or `MEDIA_DIR`). On a host whose disk is wiped on every restart, attach a persistent disk and point `MEDIA_DIR` at it, otherwise the background resets to plain. Nothing else is stored on disk.

### A. A hosting service (Render, Railway, Fly.io, Cloud Run, Heroku)

Example with **Render** (https://render.com). The repository must be on GitHub (**private** is fine).

1. **New → Web Service** → pick the repository. Runtime **Node**.
2. Build command: `npm install --include=dev && npm run build`
3. Start command: `npm start`
4. Health check path: `/health`
5. **Environment** → add `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` (paste the whole key file), `OWNER_PASSWORD`, `SESSION_SECRET`, `HOTEL_NAME`, `HOTEL_TIMEZONE`. No `.env` file is needed there.
6. Optional, for the background: add a **Disk** (paid plans) mounted at e.g. `/var/data` and set `MEDIA_DIR=/var/data/media`.
7. Deploy. Render gives an `https://…onrender.com` address. Free plans may sleep when idle (the first request is slow); paid plans do not.

Other services use the same build and start commands and the same variables. They set `PORT` themselves and the app listens on all addresses there automatically.

### B. Your own server (VPS) with a domain

On a small Linux server (Ubuntu) with Node 20+, a domain name pointing at it, and ports 80 and 443 open:

1. Copy the project (or a customer release folder) to the server, create `.env` (use `npm run setup`), then `npm install && npm run build`. In a release folder there is nothing to build: run `node server.mjs`.
2. Keep it running: `npm install -g pm2`, then `pm2 start "npm start" --name hotel`, `pm2 save`, `pm2 startup`.
3. Add `TRUST_PROXY=1` to `.env`. Leave `HOST` unset so only the proxy can reach the app.
4. Install Caddy (https://caddyserver.com), which gets the https certificate by itself. `/etc/caddy/Caddyfile`:
   ```
   hotel.example.com {
       reverse_proxy localhost:3000
   }
   ```
   then `sudo systemctl reload caddy`. Open `https://hotel.example.com`.

### C. The hotel's own computer, through a Cloudflare Tunnel

No server to rent; the computer must stay on. Free Cloudflare account and a domain managed in Cloudflare for a permanent address.

1. Start the app (`npm start`, or `start.bat` in a customer folder) with `TRUST_PROXY=1` in `.env`.
2. Install `cloudflared` and create a tunnel whose public hostname points to `http://localhost:3000` (follow Cloudflare's current Zero Trust → Tunnels instructions).
3. Quick test without a domain: `cloudflared tunnel --url http://localhost:3000` prints a temporary `https://….trycloudflare.com` address that changes each time.

### Show a live demo to a buyer

`npm run build:demo` makes `dist-demo/`, a static copy running on made-up data. Upload that folder to any static host (Netlify, Cloudflare Pages, GitHub Pages). It has no server and no real data.

## Daily use

- **Rooms** show *Occupied* automatically while a guest is checked in; you set *Available*, *Cleaning* or *Maintenance*. Checking out puts the room into *Cleaning*.
- **Payments** are separate from stages: `…` → *Payment or refund*. Each is a dated row in the Payments tab with the employee's name; "Paid" is their sum. Refunds need a reason.
- **Edit booking** (`…` menu) can fix anything later; after check-out only guest details, notes and discount stay editable. **Undo** appears after a stage change.
- **Two people at once:** saves are queued, so two staff cannot both book the same room at the same moment.
- **Security:** employee passwords are stored scrambled; the Google Sheet link is shown only after the owner password is typed; sign-in attempts are rate-limited; the session cookie is HttpOnly (and Secure on https); every change carries an anti-forgery header; text typed into the app is stored as plain text, so `=HYPERLINK(...)` cannot run as a formula.
- **Background files** are checked again on the server: real file type, size, and a video's length. On phones and with "reduce motion" a video shows a still frame.

## Sheet tabs

Columns are found **by header name**: reorder them or add your own. **Set up sheet** adds any missing tab or column and never deletes anything.

| Tab | Holds |
|---|---|
| **Rooms** | one row per room: number, floor, type, bed, sleeps, rate, status |
| **Guests** | one row per guest: name, mobile, email, ID, city |
| **Bookings** | one row per booking (3 rooms = one row, listed `101, 102, 103`): dates, discount, total, paid, balance, stage, created by, updated by |
| **Payments** | one row per payment or refund: date and time, booking, amount (refunds negative), method, by whom |
| **Staff** | employees: username, name, role, active, scrambled password. Managed from Settings; do not edit by hand |

Keep the sheet private to the owner: anyone with edit access can change anything. Employees work inside the app.

## Project structure

```
api/                     the server logic (no website code)
  handler.ts               one entry point for every /api/<action>: finds the route, checks who may call it
  routes/                  one file per subject: session, data, bookings, rooms, staff, sheet, background
  sheets/                  everything about the Google Sheet
    schema.ts                tab and column definitions
    google.ts                Google sign-in and REST calls
    access.ts                raw reading and writing, and the queue that serialises writes
    read.ts                  sheet rows -> rooms, guests, bookings, payments, staff
    bookings.ts · rooms.ts · staff.ts   the changes the app makes
    setup.ts · health.ts     "Set up sheet", connection check
    style.ts                 the Clay & Sand look of the sheet
  auth/                    password scrambling, signed sign-in cookie, sign-in rate limit
  media/                   the owner's background file: checks, storing
  lib/                     .env reading, request and error helpers, form parsing
server/                  the small web server: start.ts, network.ts (public/https), static.ts, media-serve.ts, adapt.ts, dotenv.ts
shared/                  used by BOTH the website and the server
  rules/                   validation, discounts, room clashes, stage changes (one file each)
  types/                   data shapes (booking, rooms, guests, staff, session, background)
  constants.ts · dates.ts
src/                     the website (React + TypeScript)
  App.tsx                  loads who is signed in, theme, welcome animation, then sign-in or the app
  app/                     the frame: Login, Shell, Sidebar, Topbar, Bell, Layers (pop-ups), ConfirmLogout
  features/                one folder per screen: dashboard, bookings, rooms, guests, analytics, settings
  components/              reusable pieces: Icon, Chips, Layer (pop-up/drawer), Toasts, charts, Brand, Backdrop, ThemeSwitch
  state/                   the app's data and actions (store.tsx)
  lib/                     helpers: api.ts, demo/ (the made-up hotel), format, selectors, theme, background
  styles/                  base/ = layout and colour tokens · theme/ = the Clay & Sand look · index.css = load order
public/fonts/            fonts bundled with the app (nothing is fetched from Google Fonts) and their licences
scripts/                 setup.mjs (wizard), release.mjs (customer folder), customer/ (start scripts, licence, guide)
tests/                   api/, server/, shared/, scripts/, helpers/ (no internet needed)
```

| To change… | Open |
|---|---|
| Hotel name | `.env` → `HOTEL_NAME` |
| A booking rule (discount, clash, what is required) | `shared/rules/` |
| How something is written to the sheet | `api/sheets/` (`bookings.ts`, `rooms.ts`, `staff.ts`) |
| Add or change an API action | `api/routes/` (+ `api/lib/input.ts` to check its input) |
| The colours of the app | `src/styles/base/tokens.css` |
| The look of one area | `src/styles/theme/<area>.css` |
| A screen | `src/features/<screen>/` |
| The menu, top bar, sign-in | `src/app/` |
| The demo hotel | `src/lib/demo/` |

## Commands

| Command | Does |
|---|---|
| `npm run dev` / `npm run dev:demo` | Development server, real sheet / made-up data |
| `npm run build` then `npm start` | Everyday use (`http://localhost:3000`) |
| `npm run build:demo` | Static demo in `dist-demo/` |
| `npm test` | 176 tests: rules, API, sign-in, setup, background checks, sheet styling, web serving |
| `npm run typecheck` | TypeScript check of the whole project |
| `npm run setup` | The `.env` wizard |
| `npm run release -- --licensee "Hotel Name"` | A customer zip in `release/` |

Updating from a new zip: unzip over the project keeping `.env`, `media/` and `node_modules`; run `npm install` if `package.json` changed and `npm run build` if you use `npm start`. Then, as owner, press **Set up sheet** once.

## Troubleshooting

| You see | Do this |
|---|---|
| "The server is not set up yet" | The names listed in `.env` are empty or wrong. Restart after editing `.env`. |
| "GOOGLE_SERVICE_ACCOUNT_JSON (not valid JSON)" | Copy **everything** from the first `{` to the last `}` of the key file, inside single quotes. |
| "Share the sheet with …" | Share the sheet with the service account email as **Editor**. |
| "no tab called …" | Owner → Settings → **Set up sheet**. |
| The sheet looks plain or text is faint in a tab | Owner → Settings → **Set up sheet** (restyles every tab; no data changes). |
| An employee cannot sign in | Settings → Employees → Edit: tick *Can sign in*, or set a new password. |
| A background video is refused | 15 seconds or less, under 20 MB, MP4 (H.264) or WebM. |
| Works on the computer but not from a phone | Use the https address from "Use it from anywhere". Plain `http://<ip>:3000` works only on the same Wi-Fi and needs `HOST=0.0.0.0`. |
| Many "too many wrong attempts" on the web | `TRUST_PROXY=1` is missing, so everyone looks like one visitor. |
| Port already in use | `PORT=3001 npm start` |
| Changed `.env` but nothing changed | Stop (Ctrl+C) and start again. |

**Keep the repository private.** Never commit `.env`, `media/` or the Google key.

## Selling it to hotels and franchises

Each hotel gets its **own copy, its own Google Sheet and its own Google key**, so one hotel never sees another's data and you never hold theirs.

1. `npm install`, then `npm run release -- --licensee "Customer Hotel Name"` (optional `--seller "Your Company"`).
2. This makes `release/haveli-<version>-<customer>.zip`: the built website, one bundled server file, the setup wizard, `start.bat` / `start.sh`, a licence stamped with the customer's name and `CUSTOMER-GUIDE.md`. No source code, tests or secrets. The customer needs only Node.js 20.
3. The customer follows the guide (Google Sheet and key, double-click `start.bat`, answer the wizard). The wizard asks for the hotel's name, which becomes the logo everywhere. You can do it for them over a screen-share, and set up web access with the section above.

**Protection:** the shipped files are bundled and minified, but any program on a customer's computer can in principle be copied. Real protection is the **licence** (`scripts/customer/LICENSE.txt`: one property per licence, no resale), a written sale agreement, paid updates and support, and per-customer builds so a leaked copy names its source. The licence is a template: have a lawyer adapt it to your country and pricing.
