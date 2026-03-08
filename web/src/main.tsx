import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./state/auth";
import { AdminAuthProvider } from "./state/adminAuth";
import { registerPwaServiceWorker } from "./pwa";
import "./fonts.css";
import "./styles.css";

registerPwaServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AdminAuthProvider>
        <App />
      </AdminAuthProvider>
    </AuthProvider>
  </React.StrictMode>
);
