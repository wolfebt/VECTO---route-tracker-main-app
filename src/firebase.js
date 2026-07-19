import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBGro7OUoAC1xXaBo8JjLnOQSFjZCmdoBI",
  authDomain: "route-tracker-e62b1.firebaseapp.com",
  projectId: "route-tracker-e62b1",
  storageBucket: "route-tracker-e62b1.appspot.com",
  messagingSenderId: "1016000331711",
  appId: "1:1016000331711:web:a122b8a52045ee4e832b0a",
  measurementId: "G-B476Z21SKP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache()
});
export const storage = getStorage(app);
