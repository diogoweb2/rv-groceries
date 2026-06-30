/**
 * Cloud Functions for RV & Groceries.
 *
 * Delivers a real push whenever the client writes a `notifications` document
 * (e.g. when a supermarket list is completed). The recipient's devices are
 * looked up from the `fcmTokens` collection, which the app keeps in sync.
 */

import {setGlobalOptions} from "firebase-functions";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";

initializeApp();
setGlobalOptions({maxInstances: 10});

export const onNotificationCreated = onDocumentCreated(
  "notifications/{id}",
  async (event) => {
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
    if (tokens.length === 0) return;

    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {title, body},
      data: {type: (data.type as string) ?? "general"},
    });

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
  }
);
