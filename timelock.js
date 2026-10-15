#!/usr/bin/env node
// Lock a random code (Screen Time passcode, admin password) until a set time.
//
// The code is encrypted to a future round of the drand network (timelock encryption). The key for
// that round doesn't exist until drand publishes it, so nothing on this machine can open a lock
// early: not this script, not a changed clock, not reading the files.
//
//   node timelock.js lock <name> <duration|date> [--digits N] [--password [LEN]]
//   node timelock.js list
//   node timelock.js open <name>

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import tlock from "tlock-js";

const { timelockEncrypt, timelockDecrypt, mainnetClient, roundAt, Buffer } = tlock;

const LOCKS = path.join(path.dirname(fileURLToPath(import.meta.url)), "locks");
const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/l/I

function die(msg) {
    console.error(msg);
    process.exit(1);
}

function lockPath(name) {
    if (!/^[\w.-]+$/.test(name)) die(`Use letters, digits, '.', '_' or '-' in the name, not "${name}".`);
    return path.join(LOCKS, `${name}.json`);
}

// "90m", "12h", "14d", "2w", or a date/time like "2026-11-01" or "2026-11-01T18:00"
function parseUnlock(s) {
    const m = /^(\d+)(m|h|d|w)$/.exec(s);
    if (m) return new Date(Date.now() + Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[m[2]]);
    const d = new Date(/^\d{4}-\d\d-\d\d$/.test(s) ? `${s}T00:00` : s);
    if (isNaN(d)) die(`Can't read "${s}". Use a duration like 30m, 12h, 14d, 2w, or a date like 2026-11-01.`);
    return d;
}

function left(ms) {
    const min = Math.ceil(ms / 60e3);
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    return [d && `${d}d`, h && `${h}h`, (m || (!d && !h)) && `${m}m`].filter(Boolean).join(" ");
}

function fmt(date) {
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function randomCode(opts) {
    if (opts.password) {
        return Array.from({ length: opts.password }, () => PASSWORD_CHARS[crypto.randomInt(PASSWORD_CHARS.length)]).join("");
    }
    return Array.from({ length: opts.digits }, () => crypto.randomInt(10)).join("");
}

// tlock-js logs every beacon it fetches; keep the output clean
async function quietly(fn) {
    const log = console.log;
    console.log = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
    }
}

async function lock(name, when, opts) {
    const file = lockPath(name);
    if (fs.existsSync(file)) die(`A lock called "${name}" already exists (${file}).`);
    if (!process.stdin.isTTY || !process.stdout.isTTY) die("Run this in a terminal: the code is shown on screen once.");

    const unlockAt = parseUnlock(when);
    if (unlockAt - Date.now() < 60e3) die("Pick an unlock time at least a minute from now.");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const kind = opts.password ? `${opts.password}-character password` : `${opts.digits}-digit code`;
    console.log(`\nNew ${kind} "${name}", locked until ${fmt(unlockAt)} (${left(unlockAt - Date.now())} from now).`);
    console.log("Nothing can open it before then, including you.");
    if ((await rl.question('Type "lock" to go ahead: ')).trim() !== "lock") {
        rl.close();
        die("Nothing locked.");
    }

    const client = mainnetClient();
    const info = await client.chain().info();
    const round = roundAt(unlockAt.getTime(), info);
    let code = randomCode(opts);
    const ciphertext = await timelockEncrypt(round, Buffer.from(code), client);

    // Saved before the code is shown, so a crash can't leave you with a passcode and no lock
    fs.mkdirSync(LOCKS, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ name, kind, lockedAt: new Date().toISOString(),
        unlockAt: unlockAt.toISOString(), round, chain: info.hash, ciphertext }, null, 2) + "\n");

    await rl.question("\nSaved. Press Enter to show the code, then type it in straight away. ");
    // The alternate screen keeps the code out of the terminal's scrollback
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
    process.stdout.write(`\n\n      ${code.split("").join(" ")}\n\n\n  Enter it (twice) now. Don't read it out or try to remember it.\n\n`);
    await rl.question("  Press Enter when it's set. The code disappears. ");
    process.stdout.write("\x1b[2J\x1b[?1049l");
    code = null;
    rl.close();

    console.log(`Locked. Open it after ${fmt(unlockAt)} with:  node timelock.js open ${name}`);
    console.log(`\nIf ${file} is lost, so is the code. Keep a copy somewhere else, like an email to yourself.`);
    console.log("It's safe to share: before the unlock time nobody can read it, and after it the ciphertext");
    console.log("also opens at https://timevault.drand.love without this script.");
}

function readLock(name) {
    const file = lockPath(name);
    if (!fs.existsSync(file)) die(`No lock called "${name}". See: node timelock.js list`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function list() {
    const files = fs.existsSync(LOCKS) ? fs.readdirSync(LOCKS).filter((f) => f.endsWith(".json")) : [];
    if (!files.length) return console.log("No locks yet.");
    for (const f of files.sort()) {
        const l = JSON.parse(fs.readFileSync(path.join(LOCKS, f), "utf8"));
        const ms = new Date(l.unlockAt) - Date.now();
        const state = ms > 0 ? `locked, ${left(ms)} left` : "ready to open";
        console.log(`${l.name.padEnd(16)} ${l.kind.padEnd(24)} ${fmt(new Date(l.unlockAt)).padEnd(22)} ${state}`);
    }
}

async function open(name) {
    const l = readLock(name);
    const ms = new Date(l.unlockAt) - Date.now();
    if (ms > 0) die(`"${name}" is locked until ${fmt(new Date(l.unlockAt))} (${left(ms)} left).`);
    try {
        const code = await quietly(() => timelockDecrypt(l.ciphertext, mainnetClient()));
        console.log(`\n  ${name}:  ${code.toString()}\n`);
    } catch (e) {
        if (/too early/i.test(e.message)) die(`drand hasn't published round ${l.round} yet. Try again in a minute.`);
        die(`Couldn't open "${name}": ${e.message}\nCheck your internet connection: the key comes from the drand network.`);
    }
}

function parseOpts(args) {
    const opts = { digits: 4, password: 0 };
    const rest = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--digits") opts.digits = Number(args[++i]);
        else if (args[i] === "--password") opts.password = /^\d+$/.test(args[i + 1] ?? "") ? Number(args[++i]) : 20;
        else rest.push(args[i]);
    }
    if (!(opts.digits >= 4 && opts.digits <= 12)) die("--digits takes a number from 4 to 12.");
    if (opts.password && !(opts.password >= 8 && opts.password <= 64)) die("--password takes a length from 8 to 64.");
    return [opts, rest];
}

const USAGE = `Usage:
  node timelock.js lock <name> <duration|date> [--digits N] [--password [LEN]]
      duration: 30m, 12h, 14d, 2w    date: 2026-11-01 or 2026-11-01T18:00
      default is a 4-digit code (Screen Time); --password makes a 20-character one (admin account)
  node timelock.js list
  node timelock.js open <name>`;

const [cmd, ...args] = process.argv.slice(2);
const [opts, rest] = parseOpts(args);
if (cmd === "lock" && rest.length === 2) await lock(rest[0], rest[1], opts);
else if (cmd === "list" && rest.length === 0) list();
else if (cmd === "open" && rest.length === 1) await open(rest[0]);
else die(USAGE);
