(() => {
  const cfg = window.WIKISPRINT_CONFIG || {};
  const $ = id => document.getElementById(id);
  const screens = ["home", "lobby", "race", "results"];
  let sb = null;
  let channel = null;
  let room = "";
  let me = null;
  let state = null;
  let timerId = null;
  let joinWaitId = null;
  let finishPending = false;
  let rematchPending = false;

  const difficulties = { easy: 600000, normal: 300000, hard: 180000 };

  const sampleArticles = [
    "Earth", "Sun", "Moon", "Mars", "Jupiter", "Ocean", "United_States", "Japan", "France",
    "Albert_Einstein", "William_Shakespeare", "Leonardo_da_Vinci", "Computer", "Internet",
    "Basketball", "Soccer", "Music", "Film", "Mathematics", "Physics", "Biology", "Penguin",
    "Dolphin", "Volcano", "Amazon_rainforest", "Pacific_Ocean", "World_War_II", "Ancient_Egypt",
    "Renaissance", "Space", "Solar_System", "Apple", "Coffee", "Chocolate", "Pizza", "Mountain"
  ];

  function show(id) {
    screens.forEach(s => $(s).classList.toggle("hidden", s !== id));
  }

  function cleanName(v) {
    return String(v || "").trim().replace(/\s+/g, " ").slice(0, 18) || "Player";
  }

  function makeCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function validConfig() {
    return cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && !cfg.SUPABASE_ANON_KEY.includes("YOUR_PUBLIC");
  }

  async function broadcast(type, payload) {
    if (!channel) throw new Error("The room connection is not ready.");
    try {
      await channel.send({ type: "broadcast", event: type, payload });
    } catch (e) {
      console.error("Broadcast failed", type, e);
      throw e;
    }
  }

  async function sendState() {
    if (!state || !me || state.hostId !== me.id || !channel) return;
    await broadcast("state", { state });
  }

  function saveUrl(title) {
    return "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
  }

  async function wikiSearch(q) {
    const url = "https://en.wikipedia.org/w/rest.php/v1/search/page?q=" + encodeURIComponent(q) + "&limit=1";
    const r = await fetch(url);
    if (!r.ok) throw new Error("Wikipedia search failed. Try starting the race again.");
    const d = await r.json();
    return d.pages?.[0]?.title || q;
  }

  async function chooseArticles() {
    const a = sampleArticles[Math.floor(Math.random() * sampleArticles.length)];
    let b = sampleArticles[Math.floor(Math.random() * sampleArticles.length)];
    for (let i = 0; i < 10 && b === a; i++) {
      b = sampleArticles[Math.floor(Math.random() * sampleArticles.length)];
    }
    const [start, target] = await Promise.all([wikiSearch(a), wikiSearch(b)]);
    return { start, target };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function renderPlayers() {
    const list = Object.values(state?.players || {}).sort((a, b) => Number(b.host) - Number(a.host));
    $("players").innerHTML = list.map(p =>
      `<div class="player"><span>${escapeHtml(p.name)}</span>${p.host ? '<span class="host">HOST</span>' : ''}</div>`
    ).join("");

    const amHost = Boolean(me && state && state.hostId === me.id);
    $("startBtn").classList.toggle("hidden", !amHost);
    $("difficulty").disabled = !amHost;

    if (!amHost) {
      $("lobbyMessage").textContent = "Waiting for the host to start the race…";
    } else {
      const count = list.length;
      $("lobbyMessage").textContent = count < 2
        ? "You can start solo, or wait for friends to join."
        : "Everyone is ready.";
    }
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function renderLeaderboard() {
    const ps = Object.values(state?.players || {}).sort((a, b) => {
      const af = a.finishedAt ?? Infinity;
      const bf = b.finishedAt ?? Infinity;
      return af - bf;
    });

    $("leaderboard").innerHTML = ps.map((p, i) => {
      const elapsed = p.finishedAt
        ? p.finishedAt - state.startedAt
        : Math.max(0, Date.now() - state.startedAt);
      const secs = Math.floor(elapsed / 1000);
      const time = p.finishedAt ? fmtTime(secs) : "Racing…";
      return `<div class="row"><div class="place">${p.finishedAt ? "#" + (i + 1) : "—"}</div>` +
        `<div class="player-name">${escapeHtml(p.name)}</div>` +
        `<div class="player-time ${p.finishedAt ? "finished" : ""}">${time}</div></div>`;
    }).join("");
  }

  function renderTimer() {
    if (!state?.startedAt || state.phase !== "racing") return;

    const remain = Math.max(0, state.duration - (Date.now() - state.startedAt));
    $("timer").textContent = fmtTime(Math.ceil(remain / 1000));

    if (remain <= 0) {
      clearInterval(timerId);
      timerId = null;
      if (state.hostId === me?.id) endRace("timeout");
    }
  }

  function renderRace() {
    $("raceRoom").textContent = room;
    $("targetTitle").textContent = state.target;
    $("startTitle").textContent = state.start;
    $("targetLink").href = saveUrl(state.target);
    $("startLink").href = saveUrl(state.start);
    $("raceState").textContent = "RACING";

    const myPlayer = state.players?.[me?.id];
    const hasFinished = Boolean(myPlayer?.finishedAt);
    $("finishBtn").disabled = hasFinished || finishPending;
    $("pasteBtn").disabled = hasFinished || finishPending;
    if (hasFinished) $("raceMessage").textContent = "Finish submitted!";

    renderLeaderboard();
    clearInterval(timerId);
    timerId = setInterval(() => {
      renderTimer();
      renderLeaderboard();
    }, 500);
    renderTimer();
  }

  function renderResults() {
    clearInterval(timerId);
    timerId = null;

    const ps = Object.values(state?.players || {}).sort((a, b) =>
      (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity)
    );
    const winner = ps.find(p => p.finishedAt);
    $("winnerTitle").textContent = winner ? winner.name + " wins!" : "Time's up!";
    $("winnerSubtitle").textContent = winner
      ? `Reached ${state.target} first.`
      : "Nobody reached the target before time ran out.";

    $("resultsList").innerHTML = ps.map((p, i) => {
      const sec = p.finishedAt ? Math.floor((p.finishedAt - state.startedAt) / 1000) : null;
      return `<div class="result-row"><b>${p.finishedAt ? "#" + (i + 1) : "—"}</b>` +
        `<span>${escapeHtml(p.name)}</span><strong>${sec == null ? "DNF" : fmtTime(sec)}</strong></div>`;
    }).join("");

    const amHost = Boolean(me && state.hostId === me.id);
    $("rematchBtn").textContent = amHost ? "Rematch" : "Request rematch";
    $("rematchBtn").disabled = rematchPending;
    rematchPending = false;
  }

  function handleState(newState) {
    state = newState;
    finishPending = false;
    rematchPending = false;
    $("roomCodeLabel").textContent = room;

    if (state.phase === "lobby") {
      $("difficulty").value = state.difficulty || "normal";
      show("lobby");
      renderPlayers();
    }

    if (state.phase === "racing") {
      show("race");
      renderRace();
    }

    if (state.phase === "results") {
      show("results");
      renderResults();
    }
  }

  async function connect() {
    if (!validConfig()) {
      throw new Error("Supabase configuration is missing or still contains placeholders.");
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("The Supabase browser library did not load. Refresh the page and try again.");
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  function clearJoinWait() {
    if (joinWaitId) clearTimeout(joinWaitId);
    joinWaitId = null;
  }

  async function createRoom() {
    try {
      $("createBtn").disabled = true;
      if (!sb) await connect();

      me = { id: makeId(), name: cleanName($("nameInput").value) };
      room = makeCode();
      state = {
        phase: "lobby",
        hostId: me.id,
        players: { [me.id]: { id: me.id, name: me.name, host: true } },
        difficulty: "normal",
        roundId: null,
        start: null,
        target: null,
        duration: null,
        startedAt: null
      };

      await joinChannel(true);
      handleState(state);
      await sendState();
    } catch (e) {
      console.error(e);
      $("configStatus").textContent = e.message || "Could not create the room.";
    } finally {
      $("createBtn").disabled = false;
    }
  }

  async function joinRoom() {
    try {
      $("joinBtn").disabled = true;
      if (!sb) await connect();

      me = { id: makeId(), name: cleanName($("nameInput").value) };
      room = $("roomInput").value.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(room)) throw new Error("Enter a 6-character room code.");

      state = null;
      await joinChannel(false);
      $("lobbyMessage").textContent = "Connected! Waiting for the room host…";
      show("lobby");
    } catch (e) {
      console.error(e);
      $("configStatus").textContent = e.message || "Could not join the room.";
    } finally {
      $("joinBtn").disabled = false;
    }
  }

  function scheduleJoinCheck() {
    clearJoinWait();
    joinWaitId = setTimeout(() => {
      if (!state && $("lobby") && !$("lobby").classList.contains("hidden")) {
        $("lobbyMessage").textContent = "No room state received yet. Check the room code and make sure the host still has the game open.";
      }
    }, 7000);
  }

  async function rejectJoin(message) {
    clearJoinWait();
    $("configStatus").textContent = message;
    await closeChannel();
    state = null;
    room = "";
    me = null;
    $("roomInput").value = "";
    show("home");
  }

  async function joinChannel(isHost) {
    if (!sb) throw new Error("Supabase is not connected.");

    channel = sb.channel("wikisprint-" + room, {
      config: { presence: { key: me.id } }
    });

    channel.on("broadcast", { event: "state" }, ({ payload }) => {
      if (!payload?.state) return;
      clearJoinWait();
      const incoming = structuredClone(payload.state);
      handleState(incoming);
    });

    channel.on("broadcast", { event: "request_state" }, ({ payload }) => {
      if (payload?.requester && state && state.hostId === me?.id) {
        sendState().catch(console.error);
      }
    });

    channel.on("broadcast", { event: "player_join" }, ({ payload }) => {
      const player = payload?.player;
      if (!player?.id || !player?.name || !state || state.hostId !== me?.id) return;
      if (state.players?.[player.id]) return;

      if (state.phase !== "lobby") {
        broadcast("join_rejected", {
          playerId: player.id,
          message: "The race has already started. Wait for the next rematch to join."
        }).catch(console.error);
        return;
      }

      state.players = state.players || {};
      state.players[player.id] = {
        id: player.id,
        name: cleanName(player.name),
        host: false,
        finishedAt: null,
        finishTitle: null
      };
      sendState().catch(console.error);
    });

    channel.on("broadcast", { event: "join_rejected" }, ({ payload }) => {
      if (payload?.playerId !== me?.id) return;
      rejectJoin(payload.message || "This room cannot accept a new player right now.").catch(console.error);
    });

    channel.on("broadcast", { event: "player_finish" }, ({ payload }) => {
      if (!state || state.hostId !== me?.id || state.phase !== "racing") return;
      if (payload?.roundId !== state.roundId) return;
      const playerId = payload?.playerId;
      const title = payload?.title;
      if (!playerId || !state.players?.[playerId] || !title) return;

      const wanted = normalizeTitleForCompare(state.target);
      if (normalizeTitleForCompare(title) !== wanted) return;
      if (state.players[playerId].finishedAt) return;

      state.players[playerId].finishedAt = Date.now();
      state.players[playerId].finishTitle = title;
      sendState().catch(console.error);
      setTimeout(() => {
        if (state?.hostId === me?.id && state.phase === "racing" && state.roundId === payload.roundId) {
          endRace("finish");
        }
      }, 800);
    });

    channel.on("broadcast", { event: "rematch_request" }, ({ payload }) => {
      if (!state || state.hostId !== me?.id || state.phase !== "results") return;
      if (!payload?.playerId || !state.players?.[payload.playerId]) return;
      startRematch().catch(console.error);
    });

    channel.on("broadcast", { event: "player_leave" }, ({ payload }) => {
      if (!state || state.hostId !== me?.id) return;
      if (!payload?.playerId || payload.playerId === me.id) return;
      if (!state.players?.[payload.playerId]) return;

      delete state.players[payload.playerId];
      sendState().catch(console.error);
    });

    channel.on("broadcast", { event: "room_closed" }, ({ payload }) => {
      if (payload?.playerId === me?.id) return;
      clearJoinWait();
      state = null;
      $("configStatus").textContent = "The host closed the room.";
      closeChannel().catch(console.error);
      show("home");
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      channel.subscribe(status => {
        if (status === "SUBSCRIBED") {
          finish(resolve);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          finish(reject, new Error("Could not connect to the realtime room (" + status + ")."));
        }
      });

      setTimeout(() => {
        finish(reject, new Error("Realtime connection timed out. Check that the page is using the latest files."));
      }, 12000);
    });

    if (isHost) return;

    scheduleJoinCheck();
    await broadcast("player_join", { player: { id: me.id, name: me.name, host: false } });
    await broadcast("request_state", { requester: me.id });
  }

  async function startRace() {
    if (!state || state.hostId !== me?.id || state.phase !== "lobby") return;

    $("startBtn").disabled = true;
    $("difficulty").disabled = true;
    $("lobbyMessage").textContent = "Choosing Wikipedia articles…";

    try {
      const articles = await chooseArticles();
      const difficulty = $("difficulty").value;
      state.difficulty = difficulty;
      state.start = articles.start;
      state.target = articles.target;
      state.duration = difficulties[difficulty] || difficulties.normal;
      state.startedAt = Date.now() + 2500;
      state.roundId = makeId();
      state.phase = "racing";
      Object.values(state.players || {}).forEach(p => {
        p.finishedAt = null;
        p.finishTitle = null;
      });

      await sendState();
      handleState(structuredClone(state));
    } catch (e) {
      $("lobbyMessage").textContent = e.message || "Could not start the race.";
      $("difficulty").disabled = false;
    } finally {
      $("startBtn").disabled = false;
    }
  }

  function normalizeTitleForCompare(title) {
    return String(title || "")
      .trim()
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function normalizeWikiTitle(raw) {
    try {
      const u = new URL(raw);
      if (u.hostname !== "en.wikipedia.org") return null;
      const m = u.pathname.match(/^\/wiki\/(.+)$/);
      if (!m) return null;
      return decodeURIComponent(m[1]).replace(/_/g, " ");
    } catch {
      return null;
    }
  }

  async function finish() {
    if (!state || state.phase !== "racing" || finishPending) return;

    const title = normalizeWikiTitle($("finishUrl").value);
    if (!title) {
      $("raceMessage").textContent = "Paste a valid English Wikipedia article URL.";
      return;
    }

    const wanted = normalizeTitleForCompare(state.target);
    if (normalizeTitleForCompare(title) !== wanted) {
      $("raceMessage").textContent = "That isn't the target article yet.";
      return;
    }

    if (state.players?.[me.id]?.finishedAt) return;

    finishPending = true;
    $("finishBtn").disabled = true;
    $("pasteBtn").disabled = true;
    $("raceMessage").textContent = "Submitting your finish…";

    try {
      if (state.hostId === me.id) {
        state.players[me.id].finishedAt = Date.now();
        state.players[me.id].finishTitle = title;
        await sendState();
        $("raceMessage").textContent = "Finish submitted!";
        setTimeout(() => {
          if (state?.hostId === me.id && state.phase === "racing") endRace("finish");
        }, 800);
      } else {
        await broadcast("player_finish", {
          roundId: state.roundId,
          playerId: me.id,
          title
        });
      }
    } catch (e) {
      finishPending = false;
      $("finishBtn").disabled = false;
      $("pasteBtn").disabled = false;
      $("raceMessage").textContent = "Could not submit your finish. Check your connection and try again.";
      console.error(e);
    }
  }

  async function pasteUrl() {
    if (!navigator.clipboard?.readText) {
      $("raceMessage").textContent = "Your browser does not allow clipboard access here. Paste the URL into the box manually.";
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      $("finishUrl").value = text.trim();
      $("raceMessage").textContent = "URL pasted. Click “I reached the target” to submit it.";
    } catch {
      $("raceMessage").textContent = "Clipboard access was blocked. Paste the URL into the box manually.";
    }
  }

  async function endRace(reason) {
    if (!state || state.hostId !== me?.id || state.phase !== "racing") return;
    state.phase = "results";
    state.endReason = reason;
    try {
      await sendState();
    } catch (e) {
      console.error(e);
    }
    handleState(structuredClone(state));
  }

  async function startRematch() {
    if (!state || state.hostId !== me?.id || state.phase !== "results") return;

    state.phase = "lobby";
    state.start = null;
    state.target = null;
    state.startedAt = null;
    state.duration = null;
    state.roundId = null;
    state.endReason = null;
    Object.values(state.players || {}).forEach(p => {
      p.finishedAt = null;
      p.finishTitle = null;
    });

    await sendState();
    handleState(structuredClone(state));
  }

  async function requestRematch() {
    if (!state || state.phase !== "results") return;

    if (state.hostId === me?.id) {
      await startRematch();
      return;
    }

    rematchPending = true;
    $("rematchBtn").disabled = true;
    $("winnerSubtitle").textContent = "Rematch request sent to the host…";
    try {
      await broadcast("rematch_request", { playerId: me.id });
    } catch (e) {
      rematchPending = false;
      $("rematchBtn").disabled = false;
      $("winnerSubtitle").textContent = "Could not send the rematch request. Check your connection.";
      console.error(e);
    }
  }

  async function closeChannel() {
    clearJoinWait();
    clearInterval(timerId);
    timerId = null;
    if (!channel) return;
    const current = channel;
    channel = null;
    try {
      await current.unsubscribe();
    } catch (e) {
      console.error("Could not close realtime channel", e);
    }
  }

  async function leaveRoom() {
    if (!channel || !me) {
      location.reload();
      return;
    }

    try {
      if (state?.hostId === me.id) {
        await broadcast("room_closed", { playerId: me.id });
      } else {
        await broadcast("player_leave", { playerId: me.id });
      }
    } catch (e) {
      console.error(e);
    }

    await closeChannel();
    state = null;
    room = "";
    me = null;
    $("roomInput").value = "";
    $("finishUrl").value = "";
    $("configStatus").textContent = "Left the room.";
    show("home");
  }

  $("createBtn").addEventListener("click", createRoom);
  $("joinBtn").addEventListener("click", joinRoom);
  $("startBtn").addEventListener("click", startRace);
  $("finishBtn").addEventListener("click", finish);
  $("pasteBtn").addEventListener("click", pasteUrl);
  $("rematchBtn").addEventListener("click", requestRematch);
  $("leaveBtn").addEventListener("click", leaveRoom);

  $("finishUrl").addEventListener("keydown", e => {
    if (e.key === "Enter") finish();
  });

  $("nameInput").addEventListener("keydown", e => {
    if (e.key === "Enter") createRoom();
  });

  $("roomInput").addEventListener("keydown", e => {
    if (e.key === "Enter") joinRoom();
  });

  $("roomInput").addEventListener("input", e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  $("difficulty").addEventListener("change", async e => {
    if (!state || state.hostId !== me?.id || state.phase !== "lobby") return;
    state.difficulty = e.target.value;
    try {
      await sendState();
    } catch (err) {
      console.error(err);
    }
  });

  if (!validConfig()) {
    $("configStatus").textContent = "This build needs your Supabase URL + public anon key in config.js. See README.md.";
  }
})();
