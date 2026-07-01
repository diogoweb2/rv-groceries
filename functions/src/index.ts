/**
 * Cloud Functions for RV & Groceries.
 *
 * Delivers a real push whenever the client writes a `notifications` document
 * (e.g. when a supermarket list is completed). The recipient's devices are
 * looked up from the `fcmTokens` collection, which the app keeps in sync.
 */

import {setGlobalOptions, logger} from "firebase-functions";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";

initializeApp();
setGlobalOptions({maxInstances: 10});

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
