# Cupboard

A shared store-cupboard inventory for a household: add items with their best-before date, see what's in each cupboard, and when you use something it tells you which one to take (earliest date first) and how many are left. Runs as a web app on iPhone and Android, backed by Firebase's free tier.

One deployment can serve several households. Each household's data is visible only to the Google accounts you add to it.

## How access works

- People sign in with Google. Nobody else's account is involved in storing data: it all lives in **your** Firebase project.
- Membership is stored in Firestore at `households/{id}/members/{email}`. The security rules (`firestore.rules`) let a signed-in user read and write a household's data only if their verified email has a member doc there.
- Member docs can only be written by `scripts/admin.mjs`, which uses your admin credentials. The app itself can't add or remove members.
- Nothing deployment-specific is committed to this repo. The web app gets its Firebase config from Firebase Hosting (`/__/firebase/init.json`), and households live in the database.

## Deploying your own copy

### 1. Prerequisites

- Node.js 20 or later
- The [gcloud CLI](https://cloud.google.com/sdk/docs/install) (used only to give the admin script credentials)
- A Google account to own the project (a shared household account works well, so either of you can administer it)

### 2. Create the Firebase project

In the [Firebase console](https://console.firebase.google.com/):

1. **Add project.** Google Analytics isn't needed. Stay on the free **Spark** plan.
2. **Build → Firestore Database → Create database.** Pick a nearby location (e.g. `europe-west2`); this can't be changed later. Start in **production mode**.
3. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
4. **Project settings → General → Your apps → Web app (`</>`).** Register it with Firebase Hosting ticked. You don't need to copy the config snippet.

### 3. Deploy

```sh
npm install
npx firebase login
npx firebase use --add          # pick the project; writes .firebaserc (gitignored)
npm run build                   # builds the app into dist/
npx firebase deploy             # uploads rules and the app
```

The app is now at `https://<project-id>.web.app`.

### 4. Give the admin script credentials

```sh
gcloud auth application-default login
gcloud auth application-default set-quota-project <project-id>
```

This stores credentials for your Google account on your machine; no key files are created or needed.

### 5. Set up your household

```sh
npm run admin -- add-household home "Our house"
npm run admin -- add-user home our.shared.account@gmail.com
```

`add-user` prints a link like `https://<project-id>.web.app/#h=home`. Open it on each phone and sign in with that Google account.

## Administering

```sh
npm run admin -- list                              # households and members
npm run admin -- add-household <id> [name]         # id: a-z, 0-9, -
npm run admin -- add-user <id> <email>
npm run admin -- remove-user <id> <email>          # access stops immediately
npm run admin -- link <id>                         # print a household's link
npm run admin -- remove-household <id> --purge     # deletes ALL its data
```

The project comes from `.firebaserc`, or set `FIREBASE_PROJECT` or pass `--project <id>`. If you host the app somewhere other than `<project-id>.web.app`, set `APP_URL` so the printed links are right.

### Adding a friend's household

```sh
npm run admin -- add-household smith "The Smiths"
npm run admin -- add-user smith friend.one@gmail.com
npm run admin -- add-user smith friend.two@gmail.com
```

Then send them the printed link. Bear in mind their data sits in your project and you can see it in the console; it's polite to tell them.

## Installing on phones

The household link isn't a password: anyone opening it still has to sign in with an account you've added. It's safe to send by text.

- **iPhone:** open the link in Safari, sign in, then Share → **Add to Home Screen**. Open the app from the new icon and sign in once more (home-screen apps on iOS keep their own storage). If it asks which household, type the id from the link (e.g. `home`); it's remembered after that.
- **Android:** open the link in Chrome, sign in, then menu → **Install app** (or Add to Home screen).

## Free tier

The Spark plan includes 50,000 document reads and 20,000 writes per day, with no payment method. A household typically uses a few thousand reads on a busy day, so a handful of households fit comfortably. If a limit is reached the database stops answering until the daily reset; the Spark plan can never charge you.

## Developing

Test rule changes against the Firestore emulator before deploying:

```sh
npx firebase emulators:start --only firestore,auth
```

Deploy just the rules with `npx firebase deploy --only firestore:rules`.
