# zotrider

<img width="1920" height="1080" alt="zotrider_1920x1080" src="https://github.com/user-attachments/assets/1efd8210-a866-414c-8d3d-44934549da83" />

# ZotRider

Student-to-student scooter and bike rentals at UC Irvine. Students list their own rides, set an hourly and/or daily price, approve requests, and get paid in-app.

> Independent student project — not affiliated with UC Irvine.

## Project layout

```
zotrider/
├── frontend/website/     The website (plain HTML, CSS and JavaScript)
│   ├── index.html        Main page (signed-in users only)
│   ├── login.html        Sign-in page (UCI Google accounts)
│   ├── app.js            Listings, booking, messages and listing form (demo data for now)
│   ├── auth-guard.js     Sends signed-out visitors to login.html; Log out button
│   ├── login.js          Google sign-in through Supabase
│   ├── supabase.js       Supabase connection (URL + publishable key)
│   ├── styles.css        All styles
│   └── assets/           Logo and favicon
├── supabase/migrations/  Database setup, applied in order
└── backend/              Server code (payments, coming next)
```

## Run it locally

```bash
cd frontend/website
npm run dev          # http://localhost:3000
```

VS Code's Live Server (port 5500) works too. Whichever address you use must be listed in
Supabase → Authentication → URL Configuration → Redirect URLs, or Google sign-in will fail.

## Database

Migrations live in `supabase/migrations/`. To apply new ones to the linked project:

```bash
npx supabase db push
```

## Keys

`supabase.js` contains the **publishable** key, which is safe in browser code because
row-level security protects the data. The **secret / service-role** key must never be
committed or used in `frontend/` — keep it in a `.env` file (ignored by Git).
