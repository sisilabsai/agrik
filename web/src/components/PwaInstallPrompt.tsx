import { useEffect, useMemo, useState } from "react";
import { PWA_UPDATE_EVENT } from "../pwa";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem("agrik_pwa_prompt_dismissed") === "1");
  const [iosDismissed, setIosDismissed] = useState(() => window.localStorage.getItem("agrik_pwa_ios_prompt_dismissed") === "1");
  const [offline, setOffline] = useState(() => !window.navigator.onLine);
  const [onlineNotice, setOnlineNotice] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const isStandalone = useMemo(
    () => window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    []
  );
  const isIosBrowser = useMemo(() => {
    const agent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(agent) && /safari/.test(agent) && !/crios|fxios|edgios/.test(agent);
  }, []);

  useEffect(() => {
    let onlineTimer = 0;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setDismissed(true);
      window.localStorage.setItem("agrik_pwa_prompt_dismissed", "1");
    };

    const onOffline = () => {
      window.clearTimeout(onlineTimer);
      setOffline(true);
      setOnlineNotice(false);
    };

    const onOnline = () => {
      setOffline(false);
      setOnlineNotice(true);
      onlineTimer = window.setTimeout(() => setOnlineNotice(false), 2600);
    };

    const onUpdateAvailable = (event: Event) => {
      const customEvent = event as CustomEvent<{ registration: ServiceWorkerRegistration }>;
      if (customEvent.detail?.registration) {
        setRegistration(customEvent.detail.registration);
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener(PWA_UPDATE_EVENT, onUpdateAvailable as EventListener);

    return () => {
      window.clearTimeout(onlineTimer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(PWA_UPDATE_EVENT, onUpdateAvailable as EventListener);
    };
  }, []);

  const showIosPrompt = isIosBrowser && !isStandalone && !iosDismissed;
  const showInstallPrompt = !!deferredPrompt && !dismissed;
  const showRuntimeLayer = offline || onlineNotice || !!registration || showInstallPrompt || showIosPrompt;

  if (!showRuntimeLayer) return null;

  return (
    <div className="pwa-runtime-stack">
      {offline ? (
        <div className="pwa-status-banner offline">
          <strong>Offline</strong>
          <span>Saved screens stay available. Live prices and alerts will refresh when the network returns.</span>
        </div>
      ) : null}
      {onlineNotice ? (
        <div className="pwa-status-banner online">
          <strong>Back online</strong>
          <span>AGRIK can sync fresh data again.</span>
        </div>
      ) : null}
      {registration ? (
        <div className="pwa-install-prompt">
          <div className="pwa-install-copy">
            <strong>Update ready</strong>
            <span>A newer AGRIK version is ready. Refresh once to load it.</span>
          </div>
          <div className="pwa-install-actions">
            <button
              type="button"
              className="btn small"
              onClick={() => {
                if (registration.waiting) {
                  registration.waiting.postMessage({ type: "SKIP_WAITING" });
                  return;
                }
                window.location.reload();
              }}
            >
              Refresh
            </button>
            <button type="button" className="btn ghost tiny" onClick={() => setRegistration(null)}>
              Later
            </button>
          </div>
        </div>
      ) : null}
      {showInstallPrompt ? (
        <div className="pwa-install-prompt">
          <div className="pwa-install-copy">
            <strong>Install AGRIK</strong>
            <span>Keep the app on the home screen for faster field access.</span>
          </div>
          <div className="pwa-install-actions">
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                if (!deferredPrompt) return;
                await deferredPrompt.prompt();
                const choice = await deferredPrompt.userChoice;
                if (choice.outcome === "accepted") {
                  setDeferredPrompt(null);
                }
              }}
            >
              Install
            </button>
            <button
              type="button"
              className="btn ghost tiny"
              onClick={() => {
                setDismissed(true);
                window.localStorage.setItem("agrik_pwa_prompt_dismissed", "1");
              }}
            >
              Later
            </button>
          </div>
        </div>
      ) : null}
      {showIosPrompt ? (
        <div className="pwa-install-prompt ios">
          <div className="pwa-install-copy">
            <strong>Add AGRIK to your home screen</strong>
            <span>On iPhone, open Share, then choose Add to Home Screen for app-style access.</span>
          </div>
          <div className="pwa-install-actions">
            <button
              type="button"
              className="btn ghost tiny"
              onClick={() => {
                setIosDismissed(true);
                window.localStorage.setItem("agrik_pwa_ios_prompt_dismissed", "1");
              }}
            >
              Hide
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
