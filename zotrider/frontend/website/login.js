import { supabase } from "./supabase.js";

const button = document.getElementById("login-btn");
const label = document.getElementById("login-label");
const errorText = document.getElementById("error");
const UCI = /@uci\.edu$/i;

function showError(message) {
  errorText.textContent = message;
  button.disabled = false;
  label.textContent = "Continue with UCI Google";
}

// Google sends the user back to this page after sign-in.
// If sign-in failed (e.g. a non-UCI account was blocked by the database), say why.
const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
if (params.get("error")) {
  showError("Couldn't sign you in. Make sure you pick your @uci.edu Google account.");
  history.replaceState(null, "", window.location.pathname); // clean the URL
}

// Already signed in (or just came back from Google)? Go straight to the site.
const { data: { session } } = await supabase.auth.getSession();
if (session?.user && UCI.test(session.user.email ?? "")) {
  window.location.replace("index.html");
} else if (session?.user) {
  await supabase.auth.signOut();
  showError("That isn't a UCI account. Sign in with your @uci.edu Google account.");
}

button.addEventListener("click", async () => {
  errorText.textContent = "";
  button.disabled = true;
  label.textContent = "Opening Google…";

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname, // come back to this page
      queryParams: {
        hd: "uci.edu",            // Google shows UCI accounts first
        prompt: "select_account", // always let them pick an account
      },
    },
  });
  if (error) showError("Sign-in didn't start: " + error.message);
});
