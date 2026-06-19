import { useState } from "react";
import AuthScreen from "./AuthScreen";
import FieldDashboard from "./FieldDashboard";

export default function App() {
  const [user, setUser] = useState(null);
  return user ? <FieldDashboard user={user} /> : <AuthScreen onAuthed={setUser} />;
}
