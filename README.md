# FASTER Scale daily check-in

A daily [FASTER Scale](https://fasterscaleapp.com/) check-in for Windows. It pops up the first time you use your computer each day, including after waking from sleep, and blocks websites in Chrome until you've done it. After that it checks in with you once an hour. Your data never leaves your computer, and the dashboards show how you're trending over time.

## Install (Windows 10/11)

1. **Download:** on this page, click the green **Code** button, then **Download ZIP**.
2. **Unzip:** right-click the downloaded ZIP, choose **Extract All…**, then **Extract**.
3. **Install:** in the extracted folder, double-click **`Install.cmd`**.
   - If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.
   - If it says "Open File – Security Warning", click **Run**.
   - If Python isn't installed, the installer installs it for you, which takes about a minute.
   - No admin rights are needed.
4. **Add the Chrome extension.** The installer opens Chrome's extensions page and copies the folder path for you.
   1. Turn on **Developer mode** (the switch in the top-right corner).
   2. Click **Load unpacked**, paste the path into the folder box, and click **Select Folder**.
   3. Click **Details** on "FASTER Check-in Gate" and turn on **Allow in Incognito**.
   4. Do the same at `edge://extensions` if you also use Edge.

That's it. The check-in window opens on its own once you start using the computer, if you haven't checked in yet today. You can also open it any time from **Start menu → FASTER Check-in**.

> If Chrome ever asks you at startup to "disable developer mode extensions", click **Keep**. Disabling it turns the website blocking off.

**To update:** download the new ZIP and run `Install.cmd` again. Your check-in history is kept.
**To uninstall:** double-click `Uninstall.cmd` in `%USERPROFILE%\FasterScale`. Your check-in history is kept unless you delete that folder.

## How it works

**The check-in** works the same way as [fasterscaleapp.com](https://fasterscaleapp.com/):
1. **Behaviors:** select every behavior that applies to you today, in each of the seven categories (Restoration through Relapse/Moral Failure). At least one is required.
2. **Questions:** for each category where you selected something, pick one behavior and answer three questions:
   - How does it affect me? How do I act and feel?
   - How does it affect the important people in my life?
   - Why do I do this? What is the benefit for me?

   Answers are optional, but if you write one you have to pick which behavior it's about.

Your **level** for the day is the highest category you selected a behavior in. You can add your own **custom behaviors** to any category in Settings.

**First check-in of the day.** It's required before you can browse:
- The window pops up at the first keyboard or mouse activity of the day, pinned on top. If you close it without checking in, it comes back about 90 seconds later.
- A new "day" starts at **4:00 AM**, so using the computer at 1 AM still counts as the previous day. You can change this in Settings.
- You don't need to shut down at night. Waking from sleep, unlocking, and logging in all trigger it.

**Hourly check-ins.** After the first check-in, the window comes back every 60 minutes while you're using the computer. These don't block websites.
- Closing the window skips to the next hour. Checking in early restarts the timer.
- After a long break you get one pop-up, not a backlog.
- You can change the interval or turn hourly check-ins off in Settings.

**The dashboard** is at **Start menu → FASTER Dashboard**:
- **Overview:** today's level, check-in streak, % of days in Restoration, your level over time, and behaviors by category for each day.
- **Calendar:** a year heatmap and a month-by-month breakdown.
- **Patterns:** days at each level, average level by weekday, and your most frequently selected behaviors.
- **Journal:** every check-in, including your answers, with CSV/JSON export.
- **Settings:** when the day starts, pop-up and hourly options, and custom behaviors.

### Under the hood

| Piece | What it does |
|---|---|
| **Service** (`app/server.py`, Python standard library only) | Runs in the background and only listens on `127.0.0.1:47321`. Stores check-ins in SQLite, serves the check-in and dashboard pages, and decides when to pop up the window. |
| **Scheduled task** "FASTER Scale Check-in" | Starts the service at logon, unlock, wake from sleep, and every 5 minutes as a watchdog. |
| **Browser extension** (`extension/`) | Until today's check-in is done, any website you open goes to the check-in page instead. Afterwards you're sent on to the page you wanted. If the service isn't running, websites stay blocked. |

**Behavior list.** On first run, the service downloads fasterscaleapp.com's behavior list from its open-source repository ([CorWatts/fasterscale](https://github.com/CorWatts/fasterscale), BSD-3-Clause). It's pinned to the version the site runs and saved to `data\behaviors.json`. If you're offline, a built-in paraphrased list is used and the download is retried every hour.

**Your data.**
- Everything is stored in `%USERPROFILE%\FasterScale\data\faster.db` (SQLite), with daily backups in `data\backups` (the last 14 are kept).
- Nothing is sent anywhere.
- The service rejects requests from websites, so a web page can't read your entries or check in for you.

**Limits.** This is a commitment device, not a lock. Anyone with access to the computer can turn off the extension or end the scheduled task. Firefox isn't supported.

---

The FASTER Scale is by Michael Dye (*The Genesis Process*). The check-in follows the [Unofficial Faster Scale App](https://fasterscaleapp.com/) by Corey Watts. This project isn't affiliated with either.
