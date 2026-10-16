# time-lock

Locks a random code until a time you choose. Use it for a Screen Time passcode or an admin password you
don't want to be able to get back early.

The code is encrypted to a future round of the [drand](https://drand.love) network (timelock
encryption). The decryption key for that round doesn't exist until drand publishes it, so nothing can
open a lock early. Changing the clock, editing the files or patching this script won't help.

## Setup

```bash
npm install
```

## Use

```bash
node timelock.js lock screentime 14d              # 4-digit code, opens in 14 days
node timelock.js lock admin 2026-11-01 --password # 20-character password, opens on 1 Nov
node timelock.js list
node timelock.js open screentime
```

`lock` saves the encrypted code to `locks/<name>.json` first. Then it shows the code once, on the
terminal's alternate screen so it stays out of scrollback, and clears it when you press Enter.

Durations: `30m`, `12h`, `14d`, `2w`. Dates: `2026-11-01` or `2026-11-01T18:00` (local time).
Options: `--digits N` (4–12), `--password [LEN]` (8–64, default 20).

## Web version

`web/` is a static page that does the same thing in a browser, with no server: encryption happens on the
device and the key comes from drand. Host the folder anywhere static (GitHub Pages, Netlify), or try it locally:

```bash
python3 -m http.server -d web 8000   # then open http://localhost:8000
```

It needs to be served over http(s). Opening `index.html` as a file won't load the script. Locks are kept
in the browser, and the page makes you download or copy the lock file before it shows the code. Lock files
are the same format as `locks/<name>.json`, so the page and the script can open each other's locks.

`web/tlock.js` is tlock-js bundled for the browser. Rebuild it after updating tlock-js with
`npm run build:web`.

## Screen Time on a Mac

1. System Settings → Screen Time → turn **Lock Screen Time Settings** off.
2. Run `node timelock.js lock screentime 14d` and turn the setting back on with the code it shows.
3. When it asks for an Apple Account for passcode recovery, **skip it**. With recovery on, your Apple
   ID password resets the passcode, and the lock means nothing.
4. For a stronger lock, use **Update…** on the same page to make your account a standard one, and
   lock the new admin password too (`--password`). An admin can work around Screen Time.

## Don't lose the lock file

If `locks/<name>.json` is gone, so is the code. Keep a copy somewhere else, for example by emailing it
to yourself. Sharing it is safe: no one can read it before the unlock time. After that time, the
`ciphertext` field also opens at [timevault.drand.love](https://timevault.drand.love) without this script.
Paste it with real line breaks, not the `\n`s from the JSON, or timevault rejects it. Print it with
`node -p 'require("./locks/<name>.json").ciphertext'`, or use **Copy for timevault** in the web version.

Start with short locks (a day, then a week) until you trust the setup. A lost Screen Time passcode with
recovery off means erasing the device.
