// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC3CRW7b6TmvNmsUp9V91pWTyNdkt7xbxw",
  authDomain: "yc-agro-69b5b.firebaseapp.com",
  projectId: "yc-agro-69b5b",
  storageBucket: "yc-agro-69b5b.firebasestorage.app",
  messagingSenderId: "1042780245491",
  appId: "1:1042780245491:web:622793e9248f23d18f9686",
  measurementId: "G-8S38FLCSEP"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
app.languageCode = "pa";