import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";

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

// Initialize Firebase directly with the provided config if not already initialized
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Export initialized services
export const db = firebase.firestore();
export const auth = firebase.auth();
export const googleProvider = new firebase.auth.GoogleAuthProvider();

export default firebase;