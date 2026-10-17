import { supabase } from "./supabase.js";

// Runs once when the page loads, and again whenever the user signs in or out.
supabase.auth.onAuthStateChange((event, session) => {
  const user = session?.user;

  if (!user || !user.email?.toLowerCase().endsWith("@uci.edu")) {
    // Sign out non-UCI accounts. setTimeout avoids calling Supabase
    // from inside this listener, which can freeze it.
    if (user) setTimeout(() => supabase.auth.signOut(), 0);
    window.location.replace("login.html");
    return;
  }

  window.currentUser = user;
});

window.logout = async () => {
  await supabase.auth.signOut();
  window.location.href = "login.html";
};