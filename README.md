# Haveli: hotel dashboard

Bookings, rooms, guests and money for a small hotel. Your data lives in a **Google Sheet** that you own; this app reads and writes it.
Dark "liquid glass" design, works on a laptop, tablet and phone.

> **Try it first, no setup:** `npm install` then `npm run dev:demo`. This runs on made-up data (50 rooms on 5 floors) and saves nothing.

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
7. Your sheet needs three tabs named exactly **Rooms**, **Guests** and **Bookings** with the header row described in section 6.

## 3. Fill in `.env`

1. Copy `.env.example` to a new file called `.env` (same folder).
2. **SHEET_ID**: paste the sheet's address from the browser, or just the long id between `/d/` and `/edit`.
3. **GOOGLE_SERVICE_ACCOUNT_JSON**: open the downloaded JSON file in a text editor, select everything, and paste it after the `=` inside single quotes, exactly as it is (it may span many lines, that is fine):
   `GOOGLE_SERVICE_ACCOUNT_JSON='{ ... the whole file ... }'`
4. **APP_PASSWORD**: the password staff will type to sign in (8+ characters).
5. **SESSION_SECRET**: any long random text (24+ characters). To make one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

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

The app checks the sheet every 45 seconds, so edits made directly in Google Sheets show up on their own. **Settings → Sheet status** tells you if anything is wrong (missing tab, missing column, sheet not shared, rows it could not read).

## 5. How it behaves

- **Stages:** Reserved → Checked in → Checked out, or Cancelled. Drag a card on the Bookings board, or use the `…` menu.
- **Rooms** show *Occupied* automatically while a guest is checked in. You set *Available*, *Cleaning* or *Maintenance*. Checking a guest out puts the room into *Cleaning*.
- **Double booking** is blocked: a room cannot be booked for dates that overlap an active booking.
- **Payments** are separate from stages: use `…` → *Record payment*. Checking out does not mark anything as paid.
- **Undo** appears after a stage change.
- **Two people at once:** saves are queued, so two staff members booking the same room at the same moment cannot both succeed. Run only one copy of the app against a sheet.
- **Safety:** one shared password, login attempts are rate-limited, the session cookie is HttpOnly, and every change request carries an anti-forgery header. Text typed into the app is stored as plain text in the sheet, so a guest named `=HYPERLINK(...)` cannot run as a formula.

## 6. Sheet columns

Columns are found **by header name**, so you can reorder them or add your own extra columns. Names are not case-sensitive.

| Tab | Headers |
|---|---|
| **Rooms** | Room ID, Room No, Floor, Type, Bed, Sleeps, Rate (₹/night), Status, Notes, Updated at |
| **Guests** | Guest ID, Name, Mobile, Email, ID type, ID last 4, City, Created at |
| **Bookings** | Booking ID, Guest ID, Guest name, Room No, Check-in, Check-out, Nights, Rate (₹/night), Total (₹), Paid (₹), Balance (₹), Source, Stage, Guests, Expected arrival, Notes, Created at, Updated at |

Must exist: Rooms → Room No, Type, Rate, Status. Guests → Guest ID, Name, Mobile. Bookings → Booking ID, Guest ID, Guest name, Room No, Check-in, Check-out, Rate, Paid, Source, Stage. The rest are optional.

If a header is missing, **Settings → Sheet status** names it. The first row of every tab must be the headers. Nights, Total and Balance are written as formulas by the app and also recomputed on read, so typing over them does no harm.

## 7. Updating the app (zip workflow)

New versions arrive as a zip. Unzip it **over** your project folder, keeping your `.env` and `node_modules`, then:

```bash
npm install     # only needed if package.json changed
npm run build   # if you use npm start
```

## 8. Checks

```bash
npm test             # 52 tests of the rules and the Google Sheets handling (no internet needed)
npm run typecheck    # TypeScript check of the whole project
```

## Troubleshooting

| You see | Do this |
|---|---|
| "The server is not set up yet" | The listed names in `.env` are empty or wrong. Restart after editing `.env`. |
| "Share the sheet with …" | Step 2.6: share the sheet with the service account email as **Editor**. |
| "no tab called …" | Rename the tab exactly: Rooms, Guests, Bookings. |
| "Sheet not found" | `SHEET_ID` is wrong. |
| Port already in use | `PORT=3001 npm start` |
| Changed `.env` but nothing changed | Stop the server (Ctrl+C) and start it again. |

## Project map

```
shared/   rules both sides use (validation, clash detection, dates)
api/      the server logic: sign-in, Google Sheets access
server/   tiny web server for `npm start`
src/      the website (React). pages/ = screens, modals.tsx = pop-ups
tests/    automated tests
```

This repository may be public. **Never commit `.env` or the Google JSON key.**
