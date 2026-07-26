import { useState } from "react";
import LandingPage from "./LandingPage";
import AuthScreen from "./AuthScreen";
import FieldDashboard from "./FieldDashboard";

// Flow is three states, gated in order:
//   1. entered === false  → LandingPage (marketing front door)
//   2. entered, user null → AuthScreen  (log in / register)
//   3. user set           → FieldDashboard
//
// "Open the app" on the landing page calls onEnter() to set
// entered = true. No router: this is a single client-rendered
// SPA and one piece of state decides what shows.
//
// NOTE: there's no session persistence yet (AuthScreen has no
// onAuthStateChanged), so every visit starts at the landing page.
// If you later add persisted login, initialise `entered` to true
// when a session already exists so returning users skip straight
// past the marketing page.

export default function App() {
  const [entered, setEntered] = useState(false);
  const [user, setUser] = useState(null);

  if (!entered) return <LandingPage onEnter={() => setEntered(true)} />;
  if (!user) return <AuthScreen onAuthed={setUser} />;
  return <FieldDashboard user={user} />;
}