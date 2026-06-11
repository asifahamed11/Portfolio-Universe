// src/lib/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDDmXzn9Qht_04DuQk5tWXLjcyVA4wS7mM",
  authDomain: "portfolio-universe.firebaseapp.com",
  projectId: "portfolio-universe",
  storageBucket: "portfolio-universe.firebasestorage.app",
  messagingSenderId: "893366203418",
  appId: "1:893366203418:web:13b69c585c49a443268da3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();
const githubProvider = new GithubAuthProvider();

export { app, auth, googleProvider, githubProvider, db };
