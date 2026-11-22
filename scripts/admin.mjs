#!/usr/bin/env node
// Household administration for the cupboard app.
// Authenticates with Application Default Credentials (gcloud) - no key files.
//
//   npm run admin -- <command> [args]
//
// Project: --project <id>, else $FIREBASE_PROJECT, else .firebaserc default.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const USAGE = `Usage: npm run admin -- <command> [--project <id>]

  list                              Households and their members
  add-household <id> [name...]      Create a household (id: a-z, 0-9, -)
  remove-household <id> --purge     Delete a household AND all its data
  add-user <id> <email>             Allow a Google account into a household
  remove-user <id> <email>          Revoke access (takes effect immediately)
  link <id>                         Print the login link to send to members
`;

const die = (msg) => { console.error(msg); process.exit(1); };

// ---- args ----
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
};
const has = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
};

const projectArg = flag('--project');
const purge = has('--purge');
const [cmd, ...args] = argv;
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(USAGE); process.exit(0); }

function defaultProject() {
  try {
    return JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8')).projects.default;
  } catch {
    return undefined;
  }
}

const projectId = projectArg || process.env.FIREBASE_PROJECT || defaultProject();
if (!projectId) die('No project. Run `firebase use --add`, set FIREBASE_PROJECT, or pass --project <id>.');

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

// ---- helpers ----
const checkId = (id) => {
  if (!id || !/^[a-z0-9-]{1,40}$/.test(id)) die(`Bad household id "${id ?? ''}" (use a-z, 0-9, -).`);
  return id;
};
const checkEmail = (email) => {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die(`Bad email "${email ?? ''}".`);
  return email.trim().toLowerCase();
};
const household = (id) => db.doc(`households/${id}`);
const requireHousehold = async (id) => {
  if (!(await household(id).get()).exists) die(`No household "${id}". Create it with add-household.`);
};
const appUrl = () => (process.env.APP_URL || `https://${projectId}.web.app`).replace(/\/$/, '');

// ---- commands ----
const commands = {
  async list() {
    const snap = await db.collection('households').get();
    if (snap.empty) return console.log('No households yet.');
    for (const doc of snap.docs) {
      const members = await doc.ref.collection('members').listDocuments();
      console.log(`${doc.id}  (${doc.get('name') ?? 'unnamed'})`);
      for (const m of members) console.log(`    ${m.id}`);
      if (members.length === 0) console.log('    (no members)');
    }
  },

  async 'add-household'(id, ...nameParts) {
    checkId(id);
    const ref = household(id);
    if ((await ref.get()).exists) die(`Household "${id}" already exists.`);
    await ref.set({ name: nameParts.join(' ') || id, created: FieldValue.serverTimestamp() });
    console.log(`Created household "${id}". Next: add-user ${id} <email>`);
  },

  async 'remove-household'(id) {
    checkId(id);
    await requireHousehold(id);
    if (!purge) die(`This deletes "${id}" and ALL its inventory. Re-run with --purge to confirm.`);
    await db.recursiveDelete(household(id));
    console.log(`Deleted household "${id}" and all its data.`);
  },

  async 'add-user'(id, email) {
    checkId(id);
    const e = checkEmail(email);
    await requireHousehold(id);
    await household(id).collection('members').doc(e).set({ added: FieldValue.serverTimestamp() });
    console.log(`Added ${e} to "${id}".\nSend them: ${appUrl()}/#h=${id}`);
  },

  async 'remove-user'(id, email) {
    checkId(id);
    const e = checkEmail(email);
    const ref = household(id).collection('members').doc(e);
    if (!(await ref.get()).exists) die(`${e} is not a member of "${id}".`);
    await ref.delete();
    console.log(`Removed ${e} from "${id}".`);
  },

  async link(id) {
    checkId(id);
    await requireHousehold(id);
    console.log(`${appUrl()}/#h=${id}`);
  },
};

const run = commands[cmd];
if (!run) die(`Unknown command "${cmd}".\n\n${USAGE}`);
try {
  await run(...args);
} catch (err) {
  if (/default credentials/i.test(String(err))) {
    die('No credentials. Run: gcloud auth application-default login');
  }
  die(err.message ?? String(err));
}
