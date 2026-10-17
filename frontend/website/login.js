import { supabase } from "./supabase.js";

const button = document.getElementById("login-btn");
const errorText = document.getElementById("error");

// Google sends the user back to this page after sign-in.
// If sign-in failed (e.g. a non-UCI account was blocked by the database), show why.
const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
if (params.get("error")) {
  errorText.textContent = "Couldn't sign you in. Use your @uci.edu Google account.";
  history.replaceState(null, "", window.location.pathname); // clean the URL
}

// Already signed in (or just came back from Google)? Go to the site.
const { data: { session } } = await supabase.auth.getSession();
if (session?.user?.email?.toLowerCase().endsWith("@uci.edu")) {
  window.location.replace("index.html");
}

button.addEventListener("click", async () => {
  errorText.textContent = "";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.href.split("#")[0].split("?")[0], // back to this login page
      queryParams: {
        hd: "uci.edu",            // Google shows UCI accounts first
        prompt: "select_account", // always let them pick an account
      },
    },
  });
  if (error) errorText.textContent = error.message;
});