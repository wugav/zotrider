import { supabase } from "./supabase.js";

// The page starts hidden (class "auth-pending" on <html>) so signed-out
// visitors never see a flash of the site before being sent to login.html.
const UCI = /@uci\.edu$/i;

supabase.auth.onAuthStateChange((_event, session) => {
  const user = session?.user;

  if (!user || !UCI.test(user.email ?? "")) {
    // Sign out non-UCI accounts. setTimeout avoids calling Supabase from
    // inside this listener, which can freeze it.
    if (user) setTimeout(() => supabase.auth.signOut(), 0);
    window.location.replace("login.html");
    return;
  }

  window.currentUser = user;
  document.documentElement.classList.remove("auth-pending");
});

async function logout() {
  await supabase.auth.signOut();
  window.location.replace("login.html");
}

window.logout = logout;
document.getElementById("lo")?.addEventListener("click", logout);
