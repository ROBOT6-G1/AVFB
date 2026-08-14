import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDCH-1wDkaocH6zyoHZuqBRDYjiqllnBQQ",
  authDomain: "gen-lang-client-0818068270.firebaseapp.com",
  projectId: "gen-lang-client-0818068270",
  storageBucket: "gen-lang-client-0818068270.firebasestorage.app",
  messagingSenderId: "372695402881",
  appId: "1:372695402881:web:ef6968a46a7c3ef5e10080",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = initializeFirestore(
  app,
  {},
  "ai-studio-agencevirtuelle-4025dff0-0f16-4acf-aae5-334da4c38db5",
);
const auth = getAuth(app);

let adminDb: any = null;

export async function getAdminDb() {
  if (typeof window === "undefined") {
    if (!adminDb) {
      try {
        const { getApps, initializeApp } = await import("firebase-admin/app");
        const { getFirestore } = await import("firebase-admin/firestore");
        if (getApps().length === 0) {
          initializeApp({
            projectId: "gen-lang-client-0818068270",
          });
        }
        adminDb = getFirestore("ai-studio-agencevirtuelle-4025dff0-0f16-4acf-aae5-334da4c38db5");
      } catch (err) {
        console.error("Failed to initialize firebase-admin:", err);
      }
    }
    return adminDb;
  }
  return null;
}

export { app, db, auth };
