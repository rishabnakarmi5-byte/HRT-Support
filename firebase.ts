import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Configuration provided for the HRT Concrete Tracker app
const firebaseConfig = {
  apiKey: "AIzaSyCssNAPPJvQ7DYNjhtpduV-fEoJ0oEJMFQ",
  authDomain: "hrtsupport-c6e46.firebaseapp.com",
  projectId: "hrtsupport-c6e46",
  storageBucket: "hrtsupport-c6e46.firebasestorage.app",
  messagingSenderId: "1071492035864",
  appId: "1:1071492035864:web:6b9a52271a803c3701da6d",
  measurementId: "G-46725QD8QQ"
};

// Initialize Firebase directly with the provided config
const app = initializeApp(firebaseConfig);

// Export initialized services
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
