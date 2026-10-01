(() => {
  const cfg = window.WIKISPRINT_CONFIG || {};
  const $ = id => document.getElementById(id);
  const screens = ["home","lobby","race","results"];
  let sb = null, channel = null, room = "", me = null, state = null, timerId = null;
  const difficulties = {easy: 600000, normal: 300000, hard: 180000};

  const sampleArticles = [
    "Earth","Sun","Moon","Mars","Jupiter","Ocean","United_States","Japan","France",
    "Albert_Einstein","William_Shakespeare","Leonardo_da_Vinci","Computer","Internet",
    "Basketball","Soccer","Music","Film","Mathematics","Physics","Biology","Penguin",
    "Dolphin","Volcano","Amazon_rainforest","Pacific_Ocean","World_War_II","Ancient_Egypt",
    "Renaissance","Space","Solar_System","Apple","Coffee","Chocolate","Pizza","Mountain"
  ];

  function show(id){
    screens.forEach(s => $(s).classList.toggle("hidden",s!==id));
  }
  function cleanName(v){
    return String(v||"").trim().replace(/\s+/g," ").slice(0,18) || "Player";
  }
  function makeCode(){
    const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
  }
  function makeId(){
    return crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random().toString(36).slice(2);
  }
  function validConfig(){
    return cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && !cfg.SUPABASE_ANON_KEY.includes("YOUR_PUBLIC");
  }
  function broadcast(type,payload){
    if(channel) channel.send({type:"broadcast",event:type,payload});
  }
  function saveUrl(title){
    return "https://en.wikipedia.org/wiki/"+encodeURIComponent(title.replace(/ /g,"_"));
  }

  async function wikiSearch(q){
    const url="https://en.wikipedia.org/w/rest.php/v1/search/page?q="+encodeURIComponent(q)+"&limit=1";
    const r=await fetch(url);
    if(!r.ok) throw new Error("Wikipedia search failed");
    const d=await r.json();
    return d.pages?.[0]?.title || q;
  }
  async function chooseArticles(){
    const a=sampleArticles[Math.floor(Math.random()*sampleArticles.length)];
    let b=sampleArticles[Math.floor(Math.random()*sampleArticles.length)];
    for(let i=0;i<10 && b===a;i++) b=sampleArticles[Math.floor(Math.random()*sampleArticles.length)];
    const [start,target]=await Promise.all([wikiSearch(a),wikiSearch(b)]);
    return {start,target};
  }

  function renderPlayers(){
    const list=Object.values(state?.players||{});
    $("players").innerHTML=list.map(p=>`<div class="player"><span>${escapeHtml(p.name)}</span>${p.host?'<span class="host">HOST</span>':''}</div>`).join("");
    const amHost=me && state && state.hostId===me.id;
    $("startBtn").classList.toggle("hidden",!amHost);
    if(!amHost) $("lobbyMessage").textContent="Waiting for the host to start the race…";
    else $("lobbyMessage").textContent=list.length<2?"You can start solo, or wait for friends to join.":"Everyone is ready.";
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function renderLeaderboard(){
    const ps=Object.values(state.players||{}).sort((a,b)=>{
      const af=a.finishedAt??Infinity,bf=b.finishedAt??Infinity;
      return af-bf;
    });
    $("leaderboard").innerHTML=ps.map((p,i)=>{
      const elapsed=p.finishedAt ? p.finishedAt-state.startedAt : Math.max(0,Date.now()-state.startedAt);
      const secs=Math.floor(elapsed/1000);
      const time=p.finishedAt?fmtTime(secs):"Racing…";
      return `<div class="row"><div class="place">${p.finishedAt?"#"+(i+1):"—"}</div><div class="player-name">${escapeHtml(p.name)}</div><div class="player-time ${p.finishedAt?"finished":""}">${time}</div></div>`;
    }).join("");
  }
  function fmtTime(sec){
    sec=Math.max(0,Math.floor(sec)); const m=Math.floor(sec/60),s=sec%60;
    return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
  }
  function renderTimer(){
    if(!state?.startedAt || state.phase!=="racing") return;
    const remain=Math.max(0,(state.duration-(Date.now()-state.startedAt)));
    $("timer").textContent=fmtTime(Math.ceil(remain/1000));
    if(remain<=0){
      clearInterval(timerId); timerId=null;
      if(state.hostId===me.id){ state.phase="results"; broadcast("state",{state}); }
    }
  }
  function renderRace(){
    $("raceRoom").textContent=room;
    $("targetTitle").textContent=state.target;
    $("startTitle").textContent=state.start;
    $("targetLink").href=saveUrl(state.target);
    $("startLink").href=saveUrl(state.start);
    renderLeaderboard();
    clearInterval(timerId);
    timerId=setInterval(()=>{renderTimer();renderLeaderboard()},500);
    renderTimer();
  }
  function renderResults(){
    clearInterval(timerId); timerId=null;
    const ps=Object.values(state.players||{}).sort((a,b)=>(a.finishedAt??Infinity)-(b.finishedAt??Infinity));
    const winner=ps.find(p=>p.finishedAt);
    $("winnerTitle").textContent=winner?winner.name+" wins!":"Time's up!";
    $("winnerSubtitle").textContent=winner?`Reached ${state.target} first.`:"Nobody reached the target before time ran out.";
    $("resultsList").innerHTML=ps.map((p,i)=>{
      const sec=p.finishedAt?Math.floor((p.finishedAt-state.startedAt)/1000):null;
      return `<div class="result-row"><b>${p.finishedAt?"#"+(i+1):"—"}</b><span>${escapeHtml(p.name)}</span><strong>${sec==null?"DNF":fmtTime(sec)}</strong></div>`;
    }).join("");
  }

  function handleState(newState){
    state=newState;
    if(state.phase==="lobby"){show("lobby");renderPlayers()}
    if(state.phase==="racing"){show("race");renderRace()}
    if(state.phase==="results"){show("results");renderResults()}
  }

  async function connect(){
    if(!validConfig()) throw new Error("Add your Supabase URL and anon key to config.js first.");
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  }

  async function createRoom(){
    try{
      if(!sb) await connect();
      me={id:makeId(),name:cleanName($("nameInput").value)};
      room=makeCode();
      state={phase:"lobby",hostId:me.id,players:{[me.id]:{id:me.id,name:me.name,host:true}}};
      await joinChannel();
      broadcast("state",{state});
      handleState(state);
    }catch(e){$("configStatus").textContent=e.message}
  }

  async function joinRoom(){
    try{
      if(!sb) await connect();
      me={id:makeId(),name:cleanName($("nameInput").value)};
      room=$("roomInput").value.trim().toUpperCase();
      if(!/^[A-Z0-9]{6}$/.test(room)) throw new Error("Enter a 6-character room code.");
      await joinChannel();
      broadcast("request_state",{requester:me.id});
      $("lobbyMessage").textContent="Connecting to room…";
      show("lobby");
    }catch(e){$("configStatus").textContent=e.message}
  }

  async function joinChannel(){
    channel=sb.channel("wikisprint-"+room,{config:{presence:{key:me.id}}});
    channel.on("broadcast",{event:"state"},({payload})=>{
      if(payload?.state){ handleState(structuredClone(payload.state)); }
    });
    channel.on("broadcast",{event:"request_state"},({payload})=>{
      if(payload?.requester && state && state.hostId===me.id) broadcast("state",{state});
    });
    channel.on("broadcast",{event:"player_join"},({payload})=>{
      if(!state || state.phase!=="lobby") return;
      state.players[payload.player.id]=payload.player;
      if(state.hostId===me.id) broadcast("state",{state});
      renderPlayers();
    });
    const status=await channel.subscribe();
    if(status!=="SUBSCRIBED") throw new Error("Could not connect to the realtime room.");
    if(state) broadcast("player_join",{player:state.players[me.id]});
    else broadcast("player_join",{player:{id:me.id,name:me.name,host:false}});
  }

  async function startRace(){
    if(!state || state.hostId!==me.id) return;
    $("startBtn").disabled=true;
    try{
      const articles=await chooseArticles();
      const difficulty=$("difficulty").value;
      state.start=articles.start;
      state.target=articles.target;
      state.duration=difficulties[difficulty]||300000;
      state.startedAt=Date.now()+2500;
      state.phase="racing";
      Object.values(state.players).forEach(p=>{p.finishedAt=null;p.finishTitle=null});
      broadcast("state",{state});
      handleState(state);
    }catch(e){
      $("lobbyMessage").textContent=e.message;
    }finally{$("startBtn").disabled=false}
  }

  function normalizeWikiTitle(raw){
    try{
      const u=new URL(raw);
      if(u.hostname!=="wikipedia.org" && !u.hostname.endsWith(".wikipedia.org")) return null;
      const m=u.pathname.match(/^\/wiki\/(.+)$/);
      if(!m) return null;
      return decodeURIComponent(m[1]).replace(/_/g," ");
    }catch{return null}
  }

  async function finish(){
    if(!state || state.phase!=="racing") return;
    const title=normalizeWikiTitle($("finishUrl").value);
    if(!title){$("raceMessage").textContent="Paste a valid English Wikipedia article URL.";return}
    const wanted=state.target.replace(/_/g," ").trim().toLowerCase();
    if(title.trim().toLowerCase()!==wanted){
      $("raceMessage").textContent="That isn't the target article yet.";
      return;
    }
    if(state.players[me.id].finishedAt) return;
    state.players[me.id].finishedAt=Date.now();
    state.players[me.id].finishTitle=title;
    $("raceMessage").textContent="Finish submitted!";
    broadcast("state",{state});
    handleState(state);
    if(state.hostId===me.id){
      setTimeout(()=>{
        if(state.phase==="racing" && Object.values(state.players).some(p=>p.finishedAt)){
          state.phase="results"; broadcast("state",{state}); handleState(state);
        }
      },800);
    }
  }

  $("createBtn").addEventListener("click",createRoom);
  $("joinBtn").addEventListener("click",joinRoom);
  $("startBtn").addEventListener("click",startRace);
  $("finishBtn").addEventListener("click",finish);
  $("roomInput").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
  $("rematchBtn").addEventListener("click",()=>{
    if(!state || state.hostId!==me.id) return;
    Object.values(state.players).forEach(p=>{p.finishedAt=null;p.finishTitle=null});
    state.phase="lobby"; state.start=null;state.target=null;state.startedAt=null;
    broadcast("state",{state});handleState(state);
  });
  $("leaveBtn").addEventListener("click",()=>location.reload());

  if(!validConfig()) $("configStatus").textContent="This build needs your free Supabase URL + public anon key in config.js. See README.md.";
})();