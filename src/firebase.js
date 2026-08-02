import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: localStorage.getItem('firebaseApiKey') || import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBGro7OUoAC1xXaBo8JjLnOQSFjZCmdoBI",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "route-tracker-e62b1.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "route-tracker-e62b1",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "route-tracker-e62b1.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1016000331711",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1016000331711:web:a122b8a52045ee4e832b0a",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-B476Z21SKP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache()
});
export const storage = getStorage(app);
