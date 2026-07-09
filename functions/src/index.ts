/**
 * Cloud Functions for RV & Groceries.
 *
 * Delivers a real push whenever the client writes a `notifications` document
 * (e.g. when a supermarket list is completed). The recipient's devices are
 * looked up from the `fcmTokens` collection, which the app keeps in sync.
 */

import {setGlobalOptions, logger} from "firebase-functions";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {initializeApp} from "firebase-admin/app";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";
import {getAuth} from "firebase-admin/auth";

initializeApp();
setGlobalOptions({maxInstances: 10});

const appPin = defineSecret("APP_PIN");

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Exchanges the shared app PIN for a Firebase custom auth token, so no
 * credentials ever ship in the client bundle. A global Firestore throttle
 * locks sign-in for 15 minutes after 5 consecutive wrong PINs.
 */
export const exchangePin = onCall({secrets: [appPin]}, async (request) => {
  const pin = request.data?.pin;
  if (typeof pin !== "string" || pin.length === 0) {
    throw new HttpsError("invalid-argument", "PIN is required");
  }

  const db = getFirestore();
  const throttleRef = db.collection("internal").doc("authThrottle");
  const snap = await throttleRef.get();
  const lockedUntil = snap.data()?.lockedUntil?.toMillis?.() ?? 0;
  if (Date.now() < lockedUntil) {
    throw new HttpsError(
      "resource-exhausted", "Too many attempts — try again later",
    );
  }

  if (pin !== appPin.value()) {
    const failures = ((snap.data()?.failures as number) ?? 0) + 1;
    await throttleRef.set({
      failures,
      ...(failures >= MAX_FAILURES ?
        {lockedUntil: new Date(Date.now() + LOCKOUT_MS)} :
        {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    logger.warn(`Wrong PIN attempt (${failures}/${MAX_FAILURES})`);
    throw new HttpsError("permission-denied", "Wrong PIN");
  }

  if (snap.exists) {
    await throttleRef.set(
      {failures: 0, lockedUntil: null, updatedAt: FieldValue.serverTimestamp()},
      {merge: true},
    );
  }
  const token = await getAuth().createCustomToken("shared-app-user");
  return {token};
});

export const onNotificationCreated = onDocumentCreated(
  "notifications/{id}",
  async (event) => {
    logger.info(`onNotificationCreated fired for doc ${event.params.id}`);
    const data = event.data?.data();
    if (!data) return;

    const to = data.to as string | undefined;
    if (!to) return;
    const title = (data.title as string) ?? "RV & Groceries";
    const body = (data.body as string) ?? "";

    const db = getFirestore();
    const tokensSnap = await db
      .collection("fcmTokens")
      .where("identity", "==", to)
      .get();

    const docsByToken = new Map<string, FirebaseFirestore.DocumentReference>();
    tokensSnap.docs.forEach((d) => {
      const token = d.data().token as string | undefined;
      if (token) docsByToken.set(token, d.ref);
    });
    const tokens = [...docsByToken.keys()];
    logger.info(`Notification for "${to}": found ${tokens.length} token(s)`, {
      to, title,
    });
    if (tokens.length === 0) {
      await event.data?.ref.delete();
      return;
    }

    // Data-only message: the notification is rendered exactly once by the
    // service worker's onBackgroundMessage handler (and by the in-page
    // onMessage handler when the app is focused). We deliberately omit the
    // top-level `notification`/`webpush.notification` payload — including it
    // makes the SDK auto-display a second notification, causing duplicates.
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      data: {
        title,
        body,
        type: (data.type as string) ?? "general",
        // Where a tap on the notification takes the user (service worker).
        url: (data.url as string) ?? "/",
      },
    });
    logger.info(
      `Push sent: ${res.successCount} ok, ${res.failureCount} failed`,
      {errors: res.responses.filter((r) => r.error).map((r) => r.error?.code)},
    );

    // Clean up tokens that are no longer valid so they don't accumulate.
    const stale: Promise<unknown>[] = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        const ref = docsByToken.get(tokens[i]);
        if (ref) stale.push(ref.delete());
      }
    });
    await Promise.all(stale);

    // The notification doc is a one-shot push trigger with no in-app reader, so
    // remove it once delivered to keep the collection from growing unbounded.
    await event.data?.ref.delete();
  }
);

const IDENTITIES = ["diogo", "alice"] as const;

/**
 * Pluralizes the digest's item count.
 * @param {number} n how many items were added
 * @return {string} "1 new item" / "3 new items"
 */
function plural(n: number): string {
  return `${n} new item${n === 1 ? "" : "s"}`;
}

interface DigestEntry {
  listId: string;
  store: string;
  added: number;
  total: number;
}

/**
 * The store's display name: the live `stores` record first, then the copy
 * denormalized onto the list (§15).
 * @param {FirebaseFirestore.Firestore} db firestore handle
 * @param {FirebaseFirestore.DocumentSnapshot} list the supermarket list
 * @return {Promise<string>} the store name, or "the list" if unresolvable
 */
async function storeNameFor(
  db: FirebaseFirestore.Firestore,
  list: FirebaseFirestore.DocumentSnapshot,
): Promise<string> {
  const {storeId, storeName} = list.data() ?? {};
  if (typeof storeId === "string") {
    const store = await db.collection("stores").doc(storeId).get();
    const live = store.data()?.name as string | undefined;
    if (live) return live;
  }
  return (storeName as string | undefined) ?? "the list";
}

/**
 * Daily digest of items added to Supermarket lists, at 18:00 Toronto (§15).
 * One push per person titled with the stores touched since the previous run,
 * whose body totals the additions across them — never a push per item added.
 * Silent on days with no new items.
 *
 * "New" means `createdAt` after the last run, so items written before this
 * feature shipped (no `createdAt`) are never reported.
 */
export const dailySupermarketDigest = onSchedule(
  {schedule: "0 18 * * *", timeZone: "America/Toronto"},
  async () => {
    const db = getFirestore();
    const stateRef = db.collection("internal").doc("supermarketDigest");
    const now = new Date();
    const lastRunAt = (await stateRef.get()).data()?.lastRunAt as
      | string
      | undefined;
    // First ever run: look back one day rather than over all history.
    const since =
      lastRunAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const listsSnap = await db
      .collection("supermarketLists")
      .where("status", "==", "active")
      .get();

    const touched: DigestEntry[] = [];
    for (const list of listsSnap.docs) {
      const items = await list.ref.collection("items").get();
      const added = items.docs.filter((d) => {
        const createdAt = d.data().createdAt as string | undefined;
        return createdAt !== undefined && createdAt > since;
      }).length;
      if (added === 0) continue;

      touched.push({
        listId: list.id,
        store: await storeNameFor(db, list),
        added,
        total: items.size,
      });
    }

    // Record the run even when nothing was added, so a quiet day doesn't make
    // the next digest re-report items already counted.
    await stateRef.set({lastRunAt: now.toISOString()}, {merge: true});

    if (touched.length === 0) {
      logger.info("Supermarket digest: nothing added, no push sent");
      return;
    }

    // The stores name the notification; the counts are summed across them, so
    // "total" is every touched list's size added together.
    const one = touched.length === 1 ? touched[0] : undefined;
    const title = touched.map((t) => t.store).join(" + ");
    const added = touched.reduce((n, t) => n + t.added, 0);
    const total = touched.reduce((n, t) => n + t.total, 0);
    const body = `${plural(added)} added (total: ${total})`;
    // Tapping the push opens the one store's list, or the tab when several.
    const url = one ? `/supermarket/${one.listId}` : "/supermarket";
    logger.info(`Supermarket digest: ${touched.length} store(s)`, {
      title, body,
    });

    await Promise.all(
      IDENTITIES.map((to) =>
        db.collection("notifications").add({
          to,
          from: "system",
          title,
          body,
          type: "supermarket",
          url,
          read: false,
          createdAt: now.toISOString(),
        })
      )
    );
  }
);
