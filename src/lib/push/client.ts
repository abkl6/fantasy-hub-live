/** Browser side of push: permission, service worker, subscription. */

import { getPushPublicKey, removePushSubscription, savePushSubscription } from "@/lib/push.functions";

export type PushStatus =
  | "registered"
  | "unsupported"
  | "open-in-new-tab"
  | "denied"
  | "not-configured";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function keyToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Asks for permission (needs a tap) and registers this device. */
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  if (window.top !== window.self) return "open-in-new-tab";

  const { publicKey } = await getPushPublicKey();
  if (!publicKey) return "not-configured";

  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const registration = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  await savePushSubscription({
    data: {
      endpoint: subscription.endpoint,
      p256dh: keyToBase64(subscription.getKey("p256dh")),
      auth: keyToBase64(subscription.getKey("auth")),
      userAgent: navigator.userAgent.slice(0, 200),
    },
  });
  return "registered";
}

/** Removes this device. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  await removePushSubscription({ data: { endpoint } });
}

/** iOS only shows the install banner from Safari's share sheet. */
export function isIosSafariNotInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  return isIos && !standalone;
}
