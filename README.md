# Haveli: hotel management

Bookings, rooms, guests, payments and a daily dashboard for a hotel. Your data lives in a **Google Sheet that you own**; this app reads and writes it.
A calm **Clay & Sand** design (dark by default, light on request), works on a laptop, tablet and phone.

> **Try it first, no setup:** `npm install` then `npm run dev:demo`. This runs on made-up data (50 rooms on 5 floors) and saves nothing.

**Version 0.3.0 at a glance**

- New **Clay & Sand** look: warm dark (default) and light themes, serif headings, one terracotta accent. A **sun/moon button beside the bell** (and in Settings) switches theme. Each person's last choice is remembered on sign-in.
- The **owner** can set the website **background** in Settings → **Website background**: *Plain*, the drawn *Hotel scene*, a *Photo* (JPG/PNG/WebP, up to 5 MB) or a *Video* (MP4/WebM, **15 seconds or less**, up to 20 MB, loops without a gap). Only one at a time; it shows for every user; only the owner can change it.
- The **Google Sheet gets the same look** in every tab (header, banded rows, colours for stages and room status, dropdowns, ₹ formats, frozen header). Settings → **Apply Clay & Sand style**; *Set up sheet* does it too. It never changes any value.

Earlier, in 0.2.0:

- Every person signs in with their **own username and password**. The owner adds employees in **Settings → Employees**.
- The **owner password opens any employee's account** (no need to remember theirs). Work done that way is recorded as "Name (via owner)".
- Every booking and payment records **who took it**. There is no forgot-password for employees; they ask the owner.
- One booking can hold **several rooms**, with a **discount** (₹ or %) and an automatic "amount to pay".
- Saved bookings can be **edited**. Payments and refunds go to a ledger, and **money received** is what the dashboard shows.
- **Settings** is a full page (also opened by the user button at the top right). The Google Sheet link needs the **owner password**.
- Logout asks for confirmation; the bell opens a small notification window under it; intro animation on start.
- Selling it: `npm run setup` (wizard) and `npm run release` (customer folder). See "Selling Haveli" below.

---

## 1. What you need

- **Node.js 20 or newer** (https://nodejs.org, the "LTS" button).
- **VS Code** (or any editor) and a terminal.
- A Google account that owns the Google Sheet.

## 2. Set up the Google Sheet (one time, about 10 minutes)

The app signs in to Google as a small robot account (a "service account"). You give that robot access to your sheet, and only your sheet.

1. Open https://console.cloud.google.com and create a project (any name, e.g. "Haveli").
2. In that project open **APIs & Services → Library**, search **Google Sheets API**, click **Enable**.
3. Open **IAM & Admin → Service accounts → Create service account**. Name it "haveli". Skip the optional steps and click **Done**.
4. Click the new service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. **This file is a password. Keep it private.**
5. Open the JSON file in a text editor. Copy the value of `client_email` (looks like `haveli@your-project.iam.gserviceaccount.com`).
6. Open your Google Sheet → **Share** → paste that email → give it **Editor** → untick "Notify" → **Share**.
7. Leave the sheet empty. After the first sign-in, the owner opens **Settings → Set up sheet** and the app creates its tabs (Rooms, Guests, Bookings, Payments, Staff) and columns. An older v0.1 sheet is upgraded the same way, nothing is lost.

## 3. Fill in `.env`

1. Copy `.env.example` to a new file called `.env` (same folder).
2. **SHEET_ID**: paste the sheet's address from the browser, or just the long id between `/d/` and `/edit`.
3. **GOOGLE_SERVICE_ACCOUNT_JSON**: open the downloaded JSON file in a text editor, select everything, and paste it after the `=` inside single quotes, exactly as it is (it may span many lines, that is fine):
   `GOOGLE_SERVICE_ACCOUNT_JSON='{ ... the whole file ... }'`
4. **OWNER_PASSWORD**: the owner's password (8+ characters). `APP_PASSWORD` from version 0.1 still works as the owner password.
5. **SESSION_SECRET**: any long random text (24+ characters). To make one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
6. **HOTEL_NAME**: shown on the sign-in screen. Optional: `OWNER_USERNAME` (default `owner`), `OWNER_NAME`, `HOTEL_TIMEZONE`.

**Shortcut:** `npm run setup` asks these questions, checks the Google connection and writes `.env` for you. `npm run setup -- --check` tests an existing `.env`.

`.env` is ignored by git, so it never leaves your computer. If a key ever leaks, delete it in Google Cloud and create a new one.

## 4. Run it

```bash
npm install
npm run dev            # open http://localhost:5173
```

For everyday use (faster, one process):

```bash
npm run build
npm start              # open http://localhost:3000
```

Open it from phones on the same Wi-Fi: start with `HOST=0.0.0.0 npm start` (Windows PowerShell: `$env:HOST="0.0.0.0"; npm start`) and visit `http://<this-computer's-ip>:3000`. Only do this on a network you trust: anyone who knows the password gets in.

The app checks the sheet every 45 seconds, so edits made directly in Google Sheets show up on their own.

**First run:** sign in as `owner` with the owner password → **Settings** → *Set up sheet* → *Quick room setup* → *Add employee* for each person. Settings also lists anything wrong with the sheet (missing tab or column, sheet not shared, rows it could not read).

## 5. How it behaves

- **Stages:** Reserved → Checked in → Checked out, or Cancelled. Drag a card on the Bookings board, or use the `…` menu.
- **Rooms** show *Occupied* automatically while a guest is checked in. You set *Available*, *Cleaning* or *Maintenance*. Checking a guest out puts the room into *Cleaning*.
- **Double booking** is blocked: a room cannot be booked for dates that overlap an active booking.
- **Payments** are separate from stages: `…` → *Payment or refund*. Each one is a dated row in the **Payments** tab with the employee's name; "Paid" on a booking is the sum of its payments. Refunds need a reason. Checking out does not mark anything as paid.
- **Discount** is taken off the room total (₹ or %) and is saved with the booking. **Edit booking** (`…` menu) can fix anything later; after check-out only guest details, notes and discount stay editable.
- **Several rooms, one booking:** tick as many free rooms as needed; the rate shown is the combined nightly rate.
- **Theme and background:** the sun/moon button next to the bell switches dark and light for you only (it is remembered per person). The **background** is chosen once by the owner and is the same for everyone. The file is kept in the `media/` folder next to the app (or the folder in `MEDIA_DIR`), not in the Google Sheet, and the server checks it again whatever the browser says: real file type, size, and for a video its length. On phones and with "reduce motion" on, a video background shows a still frame to save battery. It needs a server with a **writable disk** (your own computer or server); hosting with a read-only disk cannot keep it.
- **Undo** appears after a stage change.
- **Two people at once:** saves are queued, so two staff members booking the same room at the same moment cannot both succeed. Run only one copy of the app against a sheet.
- **Safety:** each person has their own login (employee passwords are stored scrambled, never readable), the Google Sheet link is only revealed after the owner password is typed, login attempts are rate-limited, the session cookie is HttpOnly, and every change request carries an anti-forgery header. Text typed into the app is stored as plain text in the sheet, so a guest named `=HYPERLINK(...)` cannot run as a formula.

## 6. Sheet tabs

Columns are found **by header name**, so you can reorder them or add your own extra columns. The owner's **Set up sheet** button adds any tab or column that is missing and never deletes anything.

| Tab | What it holds |
|---|---|
| **Rooms** | one row per room: number, floor, type, bed, sleeps, rate, status |
| **Guests** | one row per guest: name, mobile, email, ID, city |
| **Bookings** | one row per booking (a family with 3 rooms is one row, rooms listed like `101, 102, 103`), with dates, discount, total, paid, balance, stage, **created by**, **updated by** |
| **Payments** | one row per payment or refund: date and time, booking, amount (refunds negative), method, **by whom** |
| **Staff** | employees: username, name, role, active, scrambled password. Managed from Settings; do not edit by hand |

**Keep the sheet private to the owner.** Anyone with edit access to the sheet can change anything in it, and could read employee names. Employees do their work inside the app.

## 7. Updating the app (zip workflow)

New versions arrive as a zip. Unzip it **over** your project folder, keeping your `.env`, `media/` and `node_modules`, then:

```bash
npm install     # only needed if package.json changed
npm run build   # if you use npm start
```

## 8. Checks

```bash
npm test             # 159 tests: booking rules, API, sign-in, setup wizard, background upload checks, sheet styling (no internet needed)
npm run typecheck    # TypeScript check of the whole project
```

## Troubleshooting

| You see | Do this |
|---|---|
| "The server is not set up yet" | The listed names in `.env` are empty or wrong. Restart after editing `.env`. |
| "GOOGLE_SERVICE_ACCOUNT_JSON (not valid JSON)" | The key is cut off or is the wrong file. Open the downloaded key file, copy **everything** from the first `{` to the last `}`, and paste it inside single quotes. Then restart. |
| "Share the sheet with …" | Step 2.6: share the sheet with the service account email as **Editor**. |
| "Set up the sheet first" / "no tab called …" | Sign in as the owner → Settings → **Set up sheet**. |
| An employee cannot sign in | Settings → Employees → Edit: tick *Can sign in*, or set a new password. |
| A background video is refused | Keep it **15 seconds or less** and under 20 MB, as MP4 (H.264) or WebM. A phone video trimmed in its gallery app works. |
| The sheet still looks plain | Sign in as owner → Settings → **Apply Clay & Sand style**. Your own colours on the same cells may override it. |
| "Sheet not found" | `SHEET_ID` is wrong. |
| Port already in use | `PORT=3001 npm start` |
| Changed `.env` but nothing changed | Stop the server (Ctrl+C) and start it again. |

## Project map

```
shared/   rules both sides use (validation, discounts, clash detection, dates)
api/      the server logic: sign-in, staff, Google Sheets access
server/   tiny web server for `npm start`
src/      the website (React). pages/ = screens, modals.tsx = pop-ups, theme.css = the Clay & Sand look
public/    fonts (Inter, Baskerville) bundled with the app, so it works offline and sends nothing to Google Fonts
media/     the owner's background file (created on first upload; not in git)
scripts/  setup.mjs (wizard), release.mjs (customer folder), customer/ (start scripts, licence, guide)
tests/    automated tests
```

**Keep this repository private.** Never commit `.env` or the Google JSON key.

## Selling Haveli to hotels and franchises

**How a sale works.** Each hotel (or franchise unit) gets its own copy, its own Google Sheet and its own Google "robot" key, so one hotel can never see another's data, and you never hold their data.

1. `npm install` once, then `npm run release -- --licensee "Customer Hotel Name"`.
2. That makes `release/haveli-<version>-<customer>.zip`: the built website, one bundled server file, the setup wizard, `start.bat` / `start.sh`, a licence stamped with the customer's name, and `CUSTOMER-GUIDE.md`. No source code, tests or secrets. The customer only needs Node.js 20.
3. They follow the guide: make a Google Sheet and key (10 minutes), double-click `start.bat`, answer the wizard, sign in as owner, press *Set up sheet*, *Quick room setup*, add employees. You can do this for them over a screen-share.
4. `npm run release -- --seller "Your Company"` changes the licensor name on the licence (default: Swayam Koli).

**Be clear-eyed about protection.** The shipped files are bundled and minified, but any program that runs on a customer's computer can in principle be copied. Real protection is the **licence** (`scripts/customer/LICENSE.txt`: one property per licence, no resale or hosting for others), a written sale agreement, paid updates/support, and per-customer builds so a leaked copy names its source. The licence is a template: have a lawyer adapt it to your jurisdiction and pricing before you rely on it.

**Later options:** a hosted version you run for them (monthly fee, you keep it updated, but then you hold their data and need a multi-customer database), or a licence-key check against your own server.

