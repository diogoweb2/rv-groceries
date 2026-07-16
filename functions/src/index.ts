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
import {onCall, HttpsError, onRequest} from "firebase-functions/v2/https";
import {createVerify} from "node:crypto";
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
 * Today's date in Toronto as `YYYY-MM-DD`, shifted by `offsetDays`.
 * Trip dates are stored as plain date strings, so the comparison must be made
 * in the trip's own timezone rather than UTC.
 * @param {number} offsetDays days to add to today
 * @return {string} the shifted date as YYYY-MM-DD
 */
function torontoDate(offsetDays: number): string {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The America/Toronto calendar date (YYYY-MM-DD) of an ISO timestamp.
 * @param {string} iso an ISO timestamp
 * @return {string} the Toronto date as YYYY-MM-DD
 */
function torontoDateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

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
      // Bought items aren't news — the digest tells the shopper what's newly on
      // the list still to buy, and the total is what's left in the basket, not
      // the checked-off history (§15).
      const unbought = items.docs.filter((d) => !d.data().checked);
      const added = unbought.filter((d) => {
        const createdAt = d.data().createdAt as string | undefined;
        return createdAt !== undefined && createdAt > since;
      }).length;
      if (added === 0) continue;

      touched.push({
        listId: list.id,
        store: await storeNameFor(db, list),
        added,
        total: unbought.length,
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
    const body = `${plural(added)}, ${total} in total`;
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

/**
 * Prunes bought items the morning after they were checked (§15). A checked item
 * is only useful while the shopper is at the store; the next day it's clutter,
 * so once its `checkedAt` falls on an earlier Toronto date it is deleted.
 *
 * Items bought before this shipped have no `checkedAt` — they are treated as
 * already stale and removed too. A camping item that was mirrored into a trip
 * (§8) keeps its trip copy: only the Supermarket row is deleted and the trip
 * item's live link is cleared.
 */
export const dailySupermarketCleanup = onSchedule(
  {schedule: "0 4 * * *", timeZone: "America/Toronto"},
  async () => {
    const db = getFirestore();
    const today = torontoDate(0);

    const listsSnap = await db
      .collection("supermarketLists")
      .where("status", "==", "active")
      .get();

    let removed = 0;
    for (const list of listsSnap.docs) {
      const items = await list.ref.collection("items").get();
      for (const item of items.docs) {
        const data = item.data();
        // Smart Price flyer deals lapse: once `validUntil` passes, the deal
        // price no longer holds, so the unbought item leaves the list
        // automatically. Bought or camping-flagged (trip-linked) items are
        // left to the regular rules below — the person clearly wants those
        // regardless of the deal.
        const validUntil = data.validUntil as string | undefined;
        if (
          validUntil && Date.parse(validUntil) < Date.now() &&
          !data.checked && !data.forCamping
        ) {
          await item.ref.delete();
          removed++;
          continue;
        }
        if (!data.checked) continue;
        const checkedAt = data.checkedAt as string | undefined;
        // Keep items checked today; remove anything checked earlier (or with
        // no timestamp, i.e. bought before this feature shipped).
        if (checkedAt !== undefined && torontoDateOf(checkedAt) >= today) {
          continue;
        }

        const tripId = data.linkedTripId as string | undefined;
        const checklistId = data.linkedChecklistId as string | undefined;
        const itemId = data.linkedItemId as string | undefined;
        if (tripId && checklistId && itemId) {
          // The bought camping item already rode into the truck — keep the trip
          // copy, just sever its now-dangling link to this row.
          await db
            .doc(`trips/${tripId}/checklists/${checklistId}/items/${itemId}`)
            .update({
              linkedSupermarketListId: FieldValue.delete(),
              linkedSupermarketItemId: FieldValue.delete(),
            })
            .catch(() => undefined);
        }
        await item.ref.delete();
        removed++;
      }
    }

    logger.info(`Supermarket cleanup: removed ${removed} bought item(s)`);
  }
);

/**
 * Day-before item reminders, at 18:00 Toronto (§21). For every trip starting
 * tomorrow, gathers the unchecked items flagged "remind me" and sends each
 * recipient exactly one push listing their items. The flag is cleared once
 * sent, so a reminder never fires twice.
 */
export const dailyTripReminders = onSchedule(
  {schedule: "0 18 * * *", timeZone: "America/Toronto"},
  async () => {
    const db = getFirestore();
    const now = new Date();
    const tomorrow = torontoDate(1);

    const trips = await db
      .collection("trips")
      .where("startDate", "==", tomorrow)
      .get();

    for (const trip of trips.docs) {
      const status = trip.data().status as string | undefined;
      if (status === "cancelled" || status === "completed") continue;

      // name → recipients, plus the docs to clear once the push is out.
      const perUser: Record<string, string[]> = {diogo: [], alice: []};
      const flagged: FirebaseFirestore.DocumentReference[] = [];

      const checklists = await trip.ref.collection("checklists").get();
      for (const checklist of checklists.docs) {
        const items = await checklist.ref.collection("items").get();
        for (const item of items.docs) {
          const data = item.data();
          const remindTo = data.remindTo as string | undefined;
          if (!remindTo) continue;
          flagged.push(item.ref);
          if (data.checked === true) continue;
          const name = (data.name as string) ?? "an item";
          for (const to of IDENTITIES) {
            if (remindTo === to || remindTo === "both") perUser[to].push(name);
          }
        }
      }

      const title = trip.data().title as string | undefined;
      await Promise.all(
        IDENTITIES.filter((to) => perUser[to].length > 0).map((to) =>
          db.collection("notifications").add({
            to,
            from: "system",
            title: `Tomorrow: ${title ?? "your trip"}`,
            body: perUser[to].join(", "),
            type: "trip-reminder",
            url: `/trips/${trip.id}`,
            read: false,
            createdAt: now.toISOString(),
          })
        )
      );

      // Reset every flagged item — including already-checked ones, which are
      // skipped above but must not linger and fire on a later trip.
      if (flagged.length > 0) {
        const batch = db.batch();
        for (const ref of flagged) {
          batch.update(ref, {remindTo: FieldValue.delete()});
        }
        await batch.commit();
      }

      logger.info(`Trip reminders for ${trip.id}`, {
        diogo: perUser.diogo.length,
        alice: perUser.alice.length,
      });
    }
  }
);

// ── Smart Price integration (§15) ───────────────────────────────────────────
// The Smart Price app (Firebase project spmkt-cc6fd) can push a flyer deal
// onto the matching store's Supermarket list. The caller authenticates with
// its own Firebase ID token, which we verify against Google's securetoken
// certs for THAT project — no shared secret ships in any client bundle. CORS
// is additionally restricted to the Smart Price origins.

const SMARTPRICE_PROJECT = "spmkt-cc6fd";
const SMARTPRICE_ORIGINS = new Set([
  "https://spmkt-cc6fd.web.app",
  "https://spmkt-cc6fd.firebaseapp.com",
  "http://localhost:5180",
  "http://localhost:5181",
]);
const SECURETOKEN_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/" +
  "securetoken@system.gserviceaccount.com";

let secureTokenCerts: {certs: Record<string, string>; expires: number} | null =
  null;

/**
 * Fetches (and caches per the response's max-age) Google's securetoken
 * signing certificates, keyed by `kid`.
 * @return {Promise<Record<string, string>>} kid → x509 certificate PEM
 */
async function getSecureTokenCerts(): Promise<Record<string, string>> {
  if (secureTokenCerts && Date.now() < secureTokenCerts.expires) {
    return secureTokenCerts.certs;
  }
  const res = await fetch(SECURETOKEN_CERTS_URL);
  if (!res.ok) throw new Error(`cert fetch failed: HTTP ${res.status}`);
  const certs = (await res.json()) as Record<string, string>;
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "");
  const ttlMs = maxAge ? Number(maxAge[1]) * 1000 : 60 * 60 * 1000;
  secureTokenCerts = {certs, expires: Date.now() + ttlMs};
  return certs;
}

/**
 * Decodes one base64url JWT segment as JSON.
 * @param {string} part the JWT segment
 * @return {Record<string, unknown>} the decoded object
 */
function jwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/**
 * Verifies a Firebase ID token issued by the Smart Price project
 * (signature via Google's securetoken certs, then iss/aud/exp claims).
 * Throws on any failure.
 * @param {string} idToken the raw JWT from the Authorization header
 * @return {Promise<Record<string, unknown>>} the verified token payload
 */
async function verifySmartPriceToken(
  idToken: string,
): Promise<Record<string, unknown>> {
  const [h, p, sig] = idToken.split(".");
  if (!h || !p || !sig) throw new Error("malformed token");
  const header = jwtPart(h);
  if (header.alg !== "RS256") throw new Error("unexpected alg");
  const certs = await getSecureTokenCerts();
  const pem = certs[header.kid as string];
  if (!pem) throw new Error("unknown signing key");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  if (!verifier.verify(pem, Buffer.from(sig, "base64url"))) {
    throw new Error("bad signature");
  }
  const payload = jwtPart(p);
  if (payload.aud !== SMARTPRICE_PROJECT) throw new Error("wrong audience");
  if (payload.iss !== `https://securetoken.google.com/${SMARTPRICE_PROJECT}`) {
    throw new Error("wrong issuer");
  }
  if (((payload.exp as number) ?? 0) * 1000 < Date.now()) {
    throw new Error("token expired");
  }
  return payload;
}

/**
 * Normalizes a store name for matching across the two apps
 * ("No Frills" ↔ "NoFrills").
 * @param {string} name the display name
 * @return {string} lowercased alphanumeric key
 */
function storeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * POST { storeName, itemName, priceLabel?, validUntil? } — adds a Smart Price
 * flyer deal to the store's active Supermarket list (creating the store and/or
 * list when missing). An unchecked same-name item is updated in place instead
 * of duplicated. `validUntil` is epoch ms (end of the deal's last valid day);
 * expired items are hidden by the client and deleted by the daily cleanup.
 */
export const addFromSmartPrice = onRequest(async (req, res) => {
  const origin = (req.headers.origin as string | undefined) ?? "";
  if (SMARTPRICE_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Max-Age", "3600");
  }
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({error: "POST only"});
    return;
  }

  const authz = (req.headers.authorization as string | undefined) ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  try {
    await verifySmartPriceToken(token);
  } catch (e) {
    logger.warn("addFromSmartPrice: rejected token", e);
    res.status(401).json({error: "unauthorized"});
    return;
  }

  const {storeName, itemName, priceLabel, validUntil} = req.body ?? {};
  if (typeof storeName !== "string" || !storeName.trim() ||
      typeof itemName !== "string" || !itemName.trim()) {
    res.status(400).json({error: "storeName and itemName are required"});
    return;
  }

  const db = getFirestore();

  // Match the store by normalized name; create it if Smart Price knows a
  // store this app doesn't yet.
  const storesSnap = await db.collection("stores").get();
  const match = storesSnap.docs.find(
    (d) => storeKey((d.data().name as string) ?? "") === storeKey(storeName),
  );
  let storeId: string;
  let storeDisplayName: string;
  if (match) {
    storeId = match.id;
    storeDisplayName = (match.data().name as string) ?? storeName.trim();
  } else {
    const ref = await db.collection("stores").add({name: storeName.trim()});
    storeId = ref.id;
    storeDisplayName = storeName.trim();
    logger.info(`addFromSmartPrice: created store "${storeDisplayName}"`);
  }

  // Reuse the store's active list or start one (§15: one active list/store).
  const listsSnap = await db
    .collection("supermarketLists")
    .where("storeId", "==", storeId)
    .where("status", "==", "active")
    .get();
  let listId: string;
  if (!listsSnap.empty) {
    listId = listsSnap.docs[0].id;
  } else {
    const ref = await db.collection("supermarketLists").add({
      storeId,
      storeName: storeDisplayName,
      status: "active",
      createdBy: "diogo",
      createdAt: FieldValue.serverTimestamp(),
    });
    listId = ref.id;
  }

  const nowIso = new Date().toISOString();
  const validUntilIso = typeof validUntil === "number" ?
    new Date(validUntil).toISOString() :
    null;
  const deal: Record<string, unknown> = {
    sourceApp: "smartprice",
    priceLabel: typeof priceLabel === "string" ? priceLabel : null,
    validUntil: validUntilIso,
  };

  const itemsSnap = await db
    .collection(`supermarketLists/${listId}/items`)
    .get();
  const nameKey = itemName.trim().toLowerCase();
  const existing = itemsSnap.docs.find((d) =>
    ((d.data().name as string) ?? "").trim().toLowerCase() === nameKey &&
    d.data().checked !== true);

  if (existing) {
    // Same deal sent again (or a fresher week's price): refresh in place.
    await existing.ref.update({
      ...deal,
      updatedBy: "diogo",
      updatedAt: nowIso,
      rev: FieldValue.increment(1),
    });
    res.json({ok: true, status: "updated", store: storeDisplayName});
    return;
  }

  const maxOrder = itemsSnap.docs.reduce(
    (m, d) => Math.max(m, (d.data().order as number) ?? 0), -1);
  await db.collection(`supermarketLists/${listId}/items`).add({
    name: itemName.trim(),
    qty: "1",
    checked: false,
    order: maxOrder + 1,
    ...deal,
    rev: 1,
    baseRev: 0,
    updatedBy: "diogo",
    updatedAt: nowIso,
    createdAt: nowIso,
  });
  res.json({ok: true, status: "added", store: storeDisplayName});
});
