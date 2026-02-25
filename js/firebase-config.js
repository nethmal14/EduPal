// Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyAhgK_yy1gySmtKb6Y6NGbaBvVAk2XaT3A",
  authDomain: "trip-tracker-57ce0.firebaseapp.com",
  databaseURL: "https://trip-tracker-57ce0-default-rtdb.firebaseio.com",
  projectId: "trip-tracker-57ce0",
  storageBucket: "trip-tracker-57ce0.firebasestorage.app",
  messagingSenderId: "236146303848",
  appId: "1:236146303848:web:933f1e79e8a97687db6cdd",
  measurementId: "G-ZBPCS6QPR5"
};

// Valid callsigns
export const CALLSIGNS = ['NG', 'VW', 'ST', 'U1', 'U2'];

// Map callsign to a stable firebase email
export function callsignToEmail(callsign) {
  return `${callsign.toLowerCase()}@echo.secure`;
}
