/**
 * Configuración del proyecto Firebase (Web).
 * Creá un proyecto en https://console.firebase.google.com
 * → Project settings → Your apps → Web → copiá el objeto firebaseConfig aquí.
 *
 * Pasos en la consola:
 * - Authentication → Sign-in method → Google (activar).
 * - Firestore Database → crear base (modo producción o prueba).
 * - Firestore → Rules → pegá el contenido de firestore.rules del repo y publicá.
 * - Authentication → Settings → Authorized domains → añadí tu dominio (ej. usuario.github.io).
 * - (Opcional) `firebase deploy --only firestore:rules` si usás Firebase CLI.
 *
 * Las claves web son públicas por diseño; la seguridad va en Firestore Rules.
 */
window.__FIREBASE_CONFIG__ = {
  apiKey: "AIzaSyBXMXFYlMf8Mbqthy_54vJZUGOTR3LUSg4",
  authDomain: "english-palabras.firebaseapp.com",
  projectId: "english-palabras",
  storageBucket: "english-palabras.firebasestorage.app",
  messagingSenderId: "943447908855",
  appId: "1:943447908855:web:56f9270ae7e42589408ef2",
};
