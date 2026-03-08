export const PWA_UPDATE_EVENT = "agrik:pwa-update";

function notifyPwaUpdate(registration: ServiceWorkerRegistration) {
  window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT, { detail: { registration } }));
}

export function registerPwaServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");

      if (registration.waiting) {
        notifyPwaUpdate(registration);
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            notifyPwaUpdate(registration);
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    } catch (error) {
      console.warn("AGRIK service worker registration failed", error);
    }
  });
}
