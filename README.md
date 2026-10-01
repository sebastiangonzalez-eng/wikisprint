# WikiSprint — free multiplayer Wikipedia Speedrun

This is a static frontend plus Supabase Realtime. GitHub Pages can host the frontend for free.

## 1. Create the free Supabase project

1. Create a Supabase project.
2. Open Project Settings → API.
3. Copy the Project URL and the public/anon key.
4. Put them into `config.js`.

Do not use a `service_role` key in this project.

## 2. Publish on GitHub Pages

Create a public GitHub repository and upload:
- index.html
- style.css
- app.js
- config.js
- supabase-schema.sql

Then enable GitHub Pages in the repository's Settings → Pages and choose the main branch/root.

Your game will get a URL similar to:
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/

## 3. How multiplayer works

The game uses Supabase Realtime Broadcast. The host keeps the current room state and broadcasts it to everyone in the room. Presence/message limits on the free tier are far above what a small friends-only room needs.

No permanent player profiles or results are stored by this version.

## 4. Wikipedia integration

The game uses Wikimedia's public REST API to search for valid article titles. During a race it opens the real Wikipedia start and target articles in new tabs. Players navigate Wikipedia using links, then paste the article URL they reached into the game to validate the finish.

This intentionally does not scrape or proxy Wikipedia pages.

## 5. Important multiplayer behavior

The host is the authority for the room state. If the host closes the page during a race, that room will stop being authoritative. For a friends-only game this keeps the setup simple and free.

## 6. Easy upgrades

Possible next upgrades:
- automatic host migration
- custom start/target articles
- spectator mode
- round-based tournaments
- persistent statistics
- anti-cheat validation
- live route visualization
- invite links that automatically fill the room code
