# Haveli: getting started

Haveli runs the front desk of your hotel: bookings, rooms, guests, payments and a daily dashboard.
Everything is saved in a **Google Sheet that you own**. Nothing is sent to anyone else.

Version {{VERSION}} · licensed to {{LICENSEE}}

---

## What you need

- A Windows, Mac or Linux computer that stays on at the front desk (or any computer you can leave running).
- **Node.js 20 or newer**, free from https://nodejs.org (click the "LTS" button and install it).
- A Google account. This is the account that owns the sheet.

## Step 1. Make the Google Sheet and its robot account (once, about 10 minutes)

Haveli reaches your sheet through a small "robot" account that only you control.

1. Go to https://sheets.google.com and create a **blank spreadsheet**. Name it anything, for example *My Hotel*. Leave it empty.
2. Go to https://console.cloud.google.com and create a project (any name).
3. In that project open **APIs & Services → Library**, search for **Google Sheets API** and press **Enable**.
4. Open **IAM & Admin → Service accounts → Create service account**. Give it a name, such as *haveli*, and press **Done**.
5. Click the new service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. **This file is a password. Keep it private and never email it.**
6. Open that `.json` file in Notepad and copy the `client_email` value. It looks like `haveli@your-project.iam.gserviceaccount.com`.
7. Back in your Google Sheet press **Share**, paste that address, choose **Editor** and press **Share**.

## Step 2. Start Haveli

- **Windows:** double-click **start.bat**.
- **Mac / Linux:** open a terminal in this folder and run `bash start.sh`.

The first time, it asks a few questions (hotel name, your owner password, the sheet address and the key file). You can drag the `.json` file from step 1 into the window when it asks for it. Then your browser opens Haveli.
**Keep the black window open while you use Haveli.** Closing it stops the app.

## Step 3. First sign-in and setup (once)

1. Sign in with username **owner** (or the one you chose) and your **owner password**.
2. Open **Settings** (left menu, or the round picture at the top right).
3. Press **Set up sheet**. Haveli creates its tabs inside your Google Sheet.
4. Under **Quick room setup**, say how many floors and rooms per floor you have and press **Add rooms**. Later you can change names, types and prices directly in the *Rooms* tab of the sheet.
5. Under **Employees** press **Add employee**. Give each person their own username and password, and tell it to them in person.

## Daily use

- **New booking:** press *New booking*. Choose dates and tick **one or more rooms** (a big family can have several rooms on one booking). Type a discount in rupees or percent and the amount to pay updates straight away. Take an advance if the guest pays now.
- **Change a booking:** open the **⋯** menu on a booking and choose **Edit booking**. You can fix the guest, dates, rooms, discount and notes. After check-out only the guest details, notes and discount can still be changed.
- **Check in / check out:** use the **⋯** menu → *Move to*. Checking out marks the rooms for cleaning.
- **Payments and refunds:** **⋯** menu → *Payment or refund*. The dashboard's *Money received* is the money actually taken each day.
- **Who did what:** every booking and payment records the employee who made it. The bell at the top right lists today's arrivals, check-outs, dues and rooms that need attention.

## Passwords and who can see what

| Who | Can do |
| --- | --- |
| **Employee** | Bookings, rooms, guests, payments and the dashboard. Sees only their own account in Settings. |
| **Owner** | Everything above, plus employees, sheet setup, room setup, and the link to the Google Sheet. |

- The owner password also opens **any employee's account**, so you never need to remember employees' passwords. Work done this way is recorded as *"Name (via owner)"*.
- To **change an employee's password** or **switch them off**: Settings → Employees → *Edit*.
- There is no "forgot password" for employees. They ask the owner.
- The **Open the Google Sheet** button asks for the owner password every time. **Do not share the Google Sheet with employees**; they do their work inside Haveli.
- To change the owner password, open the `.env` file in this folder in Notepad, change the `OWNER_PASSWORD=` line, save, and restart Haveli.

## Using it on other devices (phone, tablet, second computer)

By default Haveli opens only on the computer it runs on. To use it from phones on the **same Wi-Fi**, add this line to the `.env` file, then restart:

```
HOST=0.0.0.0
```

Then open `http://<this computer's address>:3000` on the phone (for example `http://192.168.1.20:3000`). To reach Haveli from outside the hotel, ask your IT person to put it behind an HTTPS address. Do not open the port to the internet directly.

## Backups and safety

- Your data is the Google Sheet. Google keeps a version history (*File → Version history*).
- For an extra copy, use *File → Download → Microsoft Excel* now and then.
- Keep `.env` and the key file private. If the key file ever leaks, delete the key in Google Cloud and make a new one.
- Staff are signed out automatically after 12 hours.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "The server is not set up yet" | Double-click `setup.bat` (or run `bash setup.sh`) and answer the questions again. |
| "Could not reach Google" or bookings do not save | Check the internet. Then run `node setup.mjs --check` in this folder: it tells you in words what is wrong. |
| The sheet is "not found" or "no access" | Share the sheet with the robot email again, as **Editor** (step 1, point 7). |
| An employee cannot sign in | Settings → Employees → *Edit*: make sure *Can sign in* is ticked, or set a new password. |
| A page looks stale | Press **Refresh** on the dashboard. Haveli also refreshes by itself every 45 seconds. |

## Updating

When you receive a new version, close Haveli, unzip the new folder, and copy your old `.env` file into it. Your data stays in the Google Sheet. After starting, the owner opens Settings and presses **Set up sheet** once, in case the new version adds columns.
