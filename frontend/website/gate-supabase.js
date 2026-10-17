import { supabase } from "./supabase.js";
window.supabase = supabase;

const UCI = /@uci\.edu$/i;
const gf = document.getElementById("gf");

function showSignIn(message = "") {
  gf.innerHTML = `
    <button class="btn p" id="gbtn" style="width:100%;justify-content:center;margin-top:8px">Sign in with UCI Google</button>
    <div class="err" id="gerr" role="alert">${message}</div>`;
  document.getElementById("gbtn").onclick = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: { hd: "uci.edu", prompt: "select_account" },
      },
    });
    if (error) showSignIn("Sign-in didn't start: " + error.message);
  };
}

async function handle(session) {
  const user = session?.user;
  if (user && !UCI.test(user.email)) {
    await supabase.auth.signOut();
    showSignIn("Please use your UCI Google account (@uci.edu).");
    window.zrLock(true);
  } else if (user) {
    window.zrEmail = user.email;
    window.zrLock(false);
  } else {
    showSignIn();
    window.zrLock(true);
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => handle(session), 0);
});

document.getElementById("lo").onclick = async () => {
  window.zrResetChats();
  await supabase.auth.signOut();
};