// ============================================================
// FILE: src/lib/usePWA.ts
// Add this hook to your project, then import in App.tsx
// ============================================================

// Helper: convert VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
}

// Subscribe user to push and save to backend
async function subscribeToPush(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) return; // Already subscribed

    const response = await fetch('/api/push/vapid-public-key');
    const { publicKey } = await response.json();

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });

    console.log('[PWA] Push subscription saved ✅');
  } catch (err) {
    console.error('[PWA] Push subscription failed:', err);
  }
}

// Main PWA setup function — call once after login
export async function setupPWA(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] Service Workers not supported');
    return;
  }

  try {
    // Register service worker
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    console.log('[PWA] Service Worker registered ✅', registration.scope);

    // Wait for SW to be ready
    await navigator.serviceWorker.ready;

    // Request notification permission and subscribe
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await subscribeToPush();
      }
    }
  } catch (err) {
    console.error('[PWA] Setup failed:', err);
  }
}


// ============================================================
// HOW TO USE IN App.tsx — Add these 3 lines:
// ============================================================
//
// 1) At the top, add import:
//    import { setupPWA } from './lib/usePWA';
//
// 2) Inside App(), after your existing useEffect hooks, add:
//    useEffect(() => {
//      if (currentUser) {
//        setupPWA();
//      }
//    }, [currentUser?.id]);
//
// That's it! The PWA will activate after the user logs in.
// ============================================================
