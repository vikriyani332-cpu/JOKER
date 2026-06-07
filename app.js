/* ===== SCORE CEKIH — APP.JS — SADEWA CORP ===== */
'use strict';

// ============================================================
// STATE
// ============================================================
let state = {
  screen: 'setup', // setup | game | round-new
  ronde: 1,
  puteran: 0,
  target: 1000,
  players: [], // [{id, name, score, stars, burns, burned, tripleBurn, highestScore, isInRecoveryMode, recoveryStartPuteran, consecutiveMinus, minusStreakAudioPlayed, achievements}]
  history: [],  // [{ronde, puteran, type, data}]
  fireCandidates: [], // [{burnerId, victimId}]
  scoreHistory: [], // per puteran [{puteran, scores:[{id,score}]}]
  aiComment: '',
  undoStack: [],
  archive: {}, // {name: {stars,burns,burned,tripleBurn,highestScore}}
  gameActive: false
};

// ============================================================
// AUDIO
// ============================================================
let audioMinus0 = null;
let audioMinusMinus = null;

function initAudio() {
  try {
    audioMinus0 = new Audio('audio/mulai_dari_0_ya_bapak.wav');
    audioMinus0.preload = 'auto';
  } catch(e) {}
  try {
    audioMinusMinus = new Audio('audio/kok_minus_terus_sih_gamau_menang.wav');
    audioMinusMinus.preload = 'auto';
  } catch(e) {}
}

function stopAllAudio() {
  try { speechSynthesis.cancel(); } catch(e) {}
  if (audioMinus0) { try { audioMinus0.pause(); audioMinus0.currentTime = 0; } catch(e) {} }
  if (audioMinusMinus) { try { audioMinusMinus.pause(); audioMinusMinus.currentTime = 0; } catch(e) {} }
}

function getSuaraCowo() {
  return new Promise(resolve => {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      const male = voices.find(v => v.lang === 'id-ID' && /male|pria|laki/i.test(v.name))
        || voices.find(v => v.lang === 'id-ID')
        || voices.find(v => v.lang.startsWith('id'))
        || voices[0];
      resolve(male);
    } else {
      speechSynthesis.onvoiceschanged = () => {
        const vs = speechSynthesis.getVoices();
        const male = vs.find(v => v.lang === 'id-ID' && /male|pria|laki/i.test(v.name))
          || vs.find(v => v.lang === 'id-ID')
          || vs.find(v => v.lang.startsWith('id'))
          || vs[0];
        resolve(male);
      };
    }
  });
}

async function speak(text) {
  return new Promise(async resolve => {
    try {
      speechSynthesis.cancel();
      await new Promise(r => setTimeout(r, 100));
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'id-ID';
      utter.rate = 1;
      utter.pitch = 0.8;
      utter.volume = 1;
      utter.voice = await getSuaraCowo();
      utter.onend = resolve;
      utter.onerror = resolve;
      speechSynthesis.speak(utter);
    } catch(e) { resolve(); }
  });
}

function playAudioFile(audio) {
  return new Promise(resolve => {
    if (!audio) return resolve();
    try {
      audio.currentTime = 0;
      audio.play().then(() => {
        audio.onended = resolve;
        audio.onerror = resolve;
      }).catch(resolve);
    } catch(e) { resolve(); }
  });
}

// ============================================================
// NUMBER TO BAHASA INDONESIA
// ============================================================
function numberToBahasaIndonesia(n) {
  if (n === 0) return 'nol';
  if (isNaN(n)) return 'nol';
  let result = '';
  if (n < 0) { result = 'minus '; n = Math.abs(n); }
  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan',
    'sepuluh', 'sebelas', 'dua belas', 'tiga belas', 'empat belas', 'lima belas', 'enam belas',
    'tujuh belas', 'delapan belas', 'sembilan belas'];
  function convert(num) {
    if (num < 20) return satuan[num];
    if (num < 100) {
      const tens = Math.floor(num / 10);
      const rem = num % 10;
      const tensWord = ['', '', 'dua puluh', 'tiga puluh', 'empat puluh', 'lima puluh',
        'enam puluh', 'tujuh puluh', 'delapan puluh', 'sembilan puluh'][tens];
      return tensWord + (rem > 0 ? ' ' + satuan[rem] : '');
    }
    if (num < 200) return 'seratus' + (num % 100 > 0 ? ' ' + convert(num % 100) : '');
    if (num < 1000) {
      const hundreds = Math.floor(num / 100);
      const rem = num % 100;
      return satuan[hundreds] + ' ratus' + (rem > 0 ? ' ' + convert(rem) : '');
    }
    if (num < 2000) return 'seribu' + (num % 1000 > 0 ? ' ' + convert(num % 1000) : '');
    if (num < 1000000) {
      const thousands = Math.floor(num / 1000);
      const rem = num % 1000;
      return convert(thousands) + ' ribu' + (rem > 0 ? ' ' + convert(rem) : '');
    }
    return String(num);
  }
  result += convert(n);
  return result.trim();
}

// ============================================================
// ACHIEVEMENTS
// ============================================================
const ACHIEVEMENTS_DEF = [
  { id: 'ngocok', name: 'Tukang Ngocok Kartu', desc: 'Score minus', icon: '🃏', check: p => p.score < 0 },
  { id: 'bakar', name: 'Tukang Bakar', desc: 'Burns >= 3', icon: '🔥', check: p => p.burns >= 3 },
  { id: 'apes', name: 'Hari Apes Gak Ada Yang Tau', desc: 'Burned >= 5', icon: '😭', check: p => p.burned >= 5 },
  { id: 'dewa', name: 'Dewa Kartu', desc: 'Highest score >= 500', icon: '👑', check: p => p.highestScore >= 500 },
  { id: 'dewadewa', name: 'Dewa Dari Segala Dewa', desc: 'Stars > 1', icon: '🌟', check: p => p.stars > 1 },
  { id: 'triple', name: 'Triple Burn', desc: 'Triple burn unlocked', icon: '💥', check: p => p.tripleBurn > 0 }
];

function checkAchievements(player) {
  if (!player.achievements) player.achievements = [];
  ACHIEVEMENTS_DEF.forEach(def => {
    if (!player.achievements.includes(def.id) && def.check(player)) {
      player.achievements.push(def.id);
      showToast(`🏆 ${player.name}: ${def.name}`, 'gold');
    }
  });
}

// ============================================================
// DANGER LEVEL
// ============================================================
function getDangerLevel(player) {
  const tgt = state.target;
  // Danger is based on proximity to 0 from top OR being chased
  // We consider leading player & gap
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const maxScore = sorted[0] ? sorted[0].score : 0;
  const gap = maxScore - player.score;
  const pct = maxScore > 0 ? gap / tgt : 0;

  if (player.score < 0) return { level: 'critical', label: '🔴 Kritis', cls: 'chip-danger-critical' };
  if (player.score === 0 && state.puteran > 0) return { level: 'danger', label: '🟠 Bahaya', cls: 'chip-danger-danger' };
  if (pct > 0.6) return { level: 'danger', label: '🟠 Bahaya', cls: 'chip-danger-danger' };
  if (pct > 0.35) return { level: 'warn', label: '🟡 Waspada', cls: 'chip-danger-warn' };
  return { level: 'safe', label: '🟢 Aman', cls: 'chip-danger-safe' };
}

// ============================================================
// RANKING
// ============================================================
function computeRanking(players) {
  const sorted = [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id - b.id;
  });
  const rankMap = {};
  sorted.forEach((p, i) => { rankMap[p.id] = i + 1; });
  return rankMap;
}

// ============================================================
// SAVE / LOAD
// ============================================================
function saveState() {
  try {
    localStorage.setItem('scoreCekih_state', JSON.stringify(state));
  } catch(e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem('scoreCekih_state');
    if (raw) {
      const loaded = JSON.parse(raw);
      Object.assign(state, loaded);
      return true;
    }
  } catch(e) {}
  return false;
}

// ============================================================
// DEEP CLONE FOR UNDO
// ============================================================
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function pushUndo() {
  const snap = deepClone({
    ronde: state.ronde,
    puteran: state.puteran,
    target: state.target,
    players: state.players,
    history: state.history,
    fireCandidates: state.fireCandidates,
    scoreHistory: state.scoreHistory,
    aiComment: state.aiComment,
    archive: state.archive,
    gameActive: state.gameActive
  });
  state.undoStack.push(snap);
  if (state.undoStack.length > 50) state.undoStack.shift();
}

function doUndo() {
  stopAllAudio();
  if (state.undoStack.length === 0) { showToast('Tidak ada yang bisa di-undo', 'gold'); return; }
  const snap = state.undoStack.pop();
  state.ronde = snap.ronde;
  state.puteran = snap.puteran;
  state.target = snap.target;
  state.players = snap.players;
  state.history = snap.history;
  state.fireCandidates = snap.fireCandidates;
  state.scoreHistory = snap.scoreHistory;
  state.aiComment = snap.aiComment;
  state.archive = snap.archive;
  state.gameActive = snap.gameActive;
  saveState();
  renderGame();
  showToast('↩️ Undo berhasil');
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================
// AI COMMENTATOR
// ============================================================
function generateAIComment() {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const leader = sorted[0];
  const last = sorted[sorted.length - 1];
  const rankMap = computeRanking(state.players);
  const comments = [];

  if (state.puteran === 0) {
    comments.push(`🎮 Ronde ${state.ronde} dimulai! ${state.players.map(p => p.name).join(', ')} siap bertarung. Target ${state.target} poin!`);
    return comments[0];
  }

  // Comeback
  const recovering = state.players.filter(p => p.isInRecoveryMode);
  if (recovering.length > 0) {
    comments.push(`🔄 ${recovering.map(p => p.name).join(', ')} sedang dalam mode recovery. Awas jangan lengah!`);
  }

  // Leading
  if (leader && leader.score > 0) {
    const pct = Math.round((leader.score / state.target) * 100);
    if (pct >= 90) comments.push(`⚡ WASPADA! ${leader.name} sudah di ${pct}% dari target! Pemain lain harus bergerak cepat!`);
    else if (pct >= 70) comments.push(`🎯 ${leader.name} mendominasi dengan ${leader.score} poin — ${pct}% menuju bintang!`);
    else comments.push(`📊 ${leader.name} memimpin dengan ${leader.score} poin di Puteran ${state.puteran}`);
  }

  // Danger
  if (last && last.score < 0) {
    comments.push(`😬 ${last.name} dengan skor ${last.score} dalam kondisi KRITIS! Perlu recovery segera!`);
  }

  // Fire happened
  const lastHistory = state.history[state.history.length - 1];
  if (lastHistory && lastHistory.type === 'fire') {
    comments.push(`🔥 Bakaran baru saja terjadi! Drama semakin memanas di Ronde ${state.ronde}!`);
  }

  // Gap analysis
  if (sorted.length >= 2) {
    const gap = sorted[0].score - sorted[sorted.length-1].score;
    if (gap > state.target * 0.7) comments.push(`📉 Jarak antara pemain teratas dan bawah sangat jauh: ${gap} poin. Ini akan menentukan!`);
  }

  // Near win
  const nearWin = state.players.filter(p => p.score >= state.target * 0.85);
  if (nearWin.length > 0) {
    nearWin.forEach(p => {
      comments.push(`🌟 ${p.name} hampir menang! Tinggal ${state.target - p.score} poin lagi!`);
    });
  }

  if (comments.length === 0) {
    const generic = [
      `🃏 Puteran ${state.puteran} selesai. Pertarungan semakin sengit!`,
      `🎲 Setiap puteran bisa mengubah segalanya. Fokus!`,
      `⚔️ Strategi dan keberuntungan berjalan beriringan.`
    ];
    comments.push(generic[state.puteran % generic.length]);
  }

  return comments[Math.floor(Math.random() * comments.length)];
}

// ============================================================
// BAKARAN ENGINE V7
// ============================================================
function computeFireCandidates(rankBefore, rankAfter, scoresBefore, scoresAfter, playersAfter) {
  const candidates = [];

  // For each player whose rank improved (lower number = better rank)
  for (const pelaku of playersAfter) {
    const rankPelakuBefore = rankBefore[pelaku.id];
    const rankPelakuAfter = rankAfter[pelaku.id];

    // Pelaku rank must have improved (smaller rank number = better)
    if (rankPelakuAfter >= rankPelakuBefore) continue;

    // Find players that pelaku jumped over
    for (const korban of playersAfter) {
      if (korban.id === pelaku.id) continue;

      const rankKorbanBefore = rankBefore[korban.id];
      const rankKorbanAfter = rankAfter[korban.id];

      // Korban was ABOVE pelaku before (smaller rank number)
      if (rankKorbanBefore >= rankPelakuBefore) continue;

      // Now korban is BELOW pelaku (larger rank number)
      if (rankKorbanAfter <= rankPelakuAfter) continue;

      // Skor korban setelah > 0
      const korbanScoreAfter = scoresAfter[korban.id];
      if (korbanScoreAfter <= 0) continue;

      // Korban tidak sedang recovery
      const korbanPlayer = playersAfter.find(p => p.id === korban.id);
      if (korbanPlayer && korbanPlayer.isInRecoveryMode) continue;

      candidates.push({ burnerId: pelaku.id, victimId: korban.id });
    }
  }

  // Deduplicate
  const seen = new Set();
  return candidates.filter(c => {
    const key = `${c.burnerId}-${c.victimId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================
// EXECUTE FIRE
// ============================================================
async function executeFire(candidates) {
  if (!candidates || candidates.length === 0) return;

  // Animate fire on victim cards
  candidates.forEach(c => {
    const card = document.querySelector(`.player-card[data-id="${c.victimId}"]`);
    if (card) {
      card.classList.add('fire-anim');
      setTimeout(() => card.classList.remove('fire-anim'), 600);
    }
    showFireEmoji();
  });

  // Group by burner to check triple burn
  const burnerGroups = {};
  candidates.forEach(c => {
    if (!burnerGroups[c.burnerId]) burnerGroups[c.burnerId] = [];
    burnerGroups[c.burnerId].push(c.victimId);
  });

  // Apply burns
  const currentPuteran = state.puteran;

  for (const c of candidates) {
    const burner = state.players.find(p => p.id === c.burnerId);
    const victim = state.players.find(p => p.id === c.victimId);
    if (!burner || !victim) continue;

    // Check triple burn
    const burnerVictims = burnerGroups[c.burnerId];
    const isTriple = burnerVictims && burnerVictims.length >= 3;

    // Log to history
    const histItem = {
      ronde: state.ronde,
      puteran: state.puteran,
      type: 'fire',
      burnerName: burner.name,
      victimName: victim.name,
      isTriple
    };
    state.history.unshift(histItem);

    // Update stats
    burner.burns = (burner.burns || 0) + 1;
    victim.burned = (victim.burned || 0) + 1;

    // Victim score goes to 0
    victim.score = 0;

    // Victim enters recovery mode
    victim.isInRecoveryMode = true;
    victim.recoveryStartPuteran = currentPuteran;

    // Check if victim has been burned before (mulai_dari_0 audio handled separately)
    checkAchievements(burner);
    checkAchievements(victim);
  }

  // Apply triple burn per burner (once only)
  Object.keys(burnerGroups).forEach(burnerId => {
    if (burnerGroups[burnerId].length >= 3) {
      const burner = state.players.find(p => p.id === parseInt(burnerId));
      if (burner) burner.tripleBurn = (burner.tripleBurn || 0) + 1;
    }
  });

  // Update archive
  state.players.forEach(p => updateArchive(p));
  saveState();

  // TTS bakaran one by one
  for (const c of candidates) {
    const burner = state.players.find(p => p.id === c.burnerId);
    const victim = state.players.find(p => p.id === c.victimId);
    if (burner && victim) {
      await speak(`${burner.name} membakar ${victim.name}`);
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Play mulai dari 0 audio for burned victims
  if (audioMinus0) {
    await playAudioFile(audioMinus0);
  }

  // Update render
  renderGame();

  // Collect victim IDs for kocok kartu logic
  const burnedVictimIds = candidates.map(c => c.victimId);

  // Audio kocok kartu + total skor
  await audioKocokKartu(burnedVictimIds);
  await audioTotalSkor();
}

// ============================================================
// AUDIO KOCOK KARTU
// ============================================================
async function audioKocokKartu(justBurnedIds) {
  // Find who shuffles per spec:
  // 1. If any player has minus score → pick most minus
  // 2. If no minus & 2-3 burned at once → pick highest score BEFORE burned (we use current snapshot since burned=0)
  // 3. If no minus & no burned → pick smallest score
  const players = state.players;
  const anyMinus = players.some(p => p.score < 0);
  let shuffler = null;

  if (anyMinus) {
    // Most minus
    let minScore = Infinity;
    players.forEach(p => {
      if (p.score < minScore) { minScore = p.score; shuffler = p; }
    });
  } else if (justBurnedIds && justBurnedIds.length >= 2) {
    // 2+ burned: among burned players, pick first found (all score=0 now)
    // They are equal so pick first
    shuffler = players.find(p => justBurnedIds.includes(p.id)) || null;
    if (!shuffler) {
      let minScore = Infinity;
      players.forEach(p => {
        if (p.score < minScore) { minScore = p.score; shuffler = p; }
      });
    }
  } else {
    // Smallest score (including 0)
    let minScore = Infinity;
    players.forEach(p => {
      if (p.score < minScore) { minScore = p.score; shuffler = p; }
    });
  }

  if (shuffler) {
    await speak(`${shuffler.name} tolong kocok kartunya ya`);
  }
}

// ============================================================
// AUDIO TOTAL SKOR
// ============================================================
async function audioTotalSkor() {
  for (const p of state.players) {
    const scoreText = numberToBahasaIndonesia(p.score);
    await speak(`${p.name} mendapatkan ${scoreText} poin`);
    await new Promise(r => setTimeout(r, 200));
  }
}

// ============================================================
// FIRE ANIMATION
// ============================================================
function showFireEmoji() {
  const overlay = document.getElementById('fire-overlay');
  if (!overlay) return;
  overlay.style.display = 'block';
  for (let i = 0; i < 8; i++) {
    const el = document.createElement('div');
    el.className = 'fire-emoji';
    el.textContent = ['🔥','💥','🌋','⚡'][i % 4];
    el.style.left = (Math.random() * 90 + 5) + '%';
    el.style.top = (Math.random() * 60 + 20) + '%';
    el.style.animationDuration = (0.8 + Math.random() * 0.7) + 's';
    overlay.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
  setTimeout(() => { overlay.style.display = 'none'; }, 2000);
}

// ============================================================
// WIN HANDLING
// ============================================================
async function handleWin(winner) {
  // Show win overlay
  const overlay = document.getElementById('win-overlay');
  if (overlay) {
    overlay.classList.add('active');
    document.getElementById('win-name').textContent = winner.name;
    startStarRain();
  }

  await speak(`Selamat ya ${winner.name} mendapatkan bintang satu`);
  await speak(`Ronde selesai, selamat berjuang dan fokus`);

  // After TTS, show new round button
  setTimeout(() => {
    if (overlay) overlay.classList.remove('active');
    showRoundNew();
  }, 3000);
}

function startStarRain() {
  const rain = document.getElementById('star-rain');
  if (!rain) return;
  for (let i = 0; i < 30; i++) {
    setTimeout(() => {
      const star = document.createElement('div');
      star.className = 'star-particle';
      star.textContent = ['⭐','🌟','✨','💫'][Math.floor(Math.random() * 4)];
      star.style.left = Math.random() * 100 + '%';
      star.style.animationDuration = (1.5 + Math.random() * 2) + 's';
      star.style.animationDelay = '0s';
      rain.appendChild(star);
      setTimeout(() => star.remove(), 4000);
    }, i * 100);
  }
}

// ============================================================
// ARCHIVE UPDATE
// ============================================================
function updateArchive(player) {
  if (!state.archive) state.archive = {};
  const name = player.name;
  if (!state.archive[name]) {
    state.archive[name] = { stars: 0, burns: 0, burned: 0, tripleBurn: 0, highestScore: 0, achievements: [] };
  }
  const arch = state.archive[name];
  arch.stars = Math.max(arch.stars || 0, player.stars || 0);
  arch.burns = Math.max(arch.burns || 0, player.burns || 0);
  arch.burned = Math.max(arch.burned || 0, player.burned || 0);
  arch.tripleBurn = Math.max(arch.tripleBurn || 0, player.tripleBurn || 0);
  arch.highestScore = Math.max(arch.highestScore || 0, player.highestScore || 0);
  if (player.achievements) {
    player.achievements.forEach(a => {
      if (!arch.achievements) arch.achievements = [];
      if (!arch.achievements.includes(a)) arch.achievements.push(a);
    });
  }
}

// ============================================================
// RECOVERY UPDATE
// ============================================================
function updateRecoveryStatus() {
  // Called at start of processing a puteran
  // Recovery lasts 1 puteran after terbakar
  // If burned at puteran X, protected at puteran X+1, normal at X+2
  state.players.forEach(p => {
    if (p.isInRecoveryMode) {
      // If current puteran > recoveryStartPuteran + 1, exit recovery
      if (state.puteran > p.recoveryStartPuteran + 1) {
        p.isInRecoveryMode = false;
        p.recoveryStartPuteran = null;
      }
    }
  });
}

// ============================================================
// SAVE PUTERAN
// ============================================================
async function savePuteran() {
  const inputs = document.querySelectorAll('.score-input-field');
  if (!inputs || inputs.length === 0) return;

  // Validate inputs
  const values = {};
  let valid = true;
  inputs.forEach(inp => {
    const id = parseInt(inp.dataset.id);
    const val = parseInt(inp.value);
    if (isNaN(val)) { valid = false; return; }
    if (val > 1000) { showToast(`Maksimal +1000 per puteran`, 'fire'); valid = false; return; }
    values[id] = val;
  });

  if (!valid) { showToast('Isi semua nilai skor dengan benar!', 'fire'); return; }

  // Push undo snapshot
  pushUndo();

  // Increment puteran
  state.puteran++;

  // Update recovery status for this new puteran BEFORE applying scores
  // Recovery check: exit recovery if puteran > recoveryStartPuteran + 1
  // This is checked BEFORE scores so we know who was in recovery when this puteran starts
  const recoveryExiting = {}; // players exiting recovery THIS puteran
  state.players.forEach(p => {
    if (p.isInRecoveryMode && state.puteran > p.recoveryStartPuteran + 1) {
      recoveryExiting[p.id] = true;
    }
  });

  // Track who was in recovery at START of this puteran (before exiting)
  const wasInRecoveryAtStart = {};
  state.players.forEach(p => { wasInRecoveryAtStart[p.id] = p.isInRecoveryMode; });

  // Exit recovery for those whose time is up
  state.players.forEach(p => {
    if (recoveryExiting[p.id]) {
      p.isInRecoveryMode = false;
      p.recoveryStartPuteran = null;
    }
  });

  // Capture rank before
  const rankBefore = computeRanking(state.players);
  const scoresBefore = {};
  state.players.forEach(p => { scoresBefore[p.id] = p.score; });

  // Apply scores
  const histScores = [];
  state.players.forEach(p => {
    const delta = (values[p.id] !== undefined) ? values[p.id] : 0;
    p.score += delta;
    histScores.push({ id: p.id, name: p.name, delta, total: p.score });

    // Update highestScore
    if (p.score > (p.highestScore || 0)) p.highestScore = p.score;

    // Consecutive minus tracking
    if (delta < 0) {
      p.consecutiveMinus = (p.consecutiveMinus || 0) + 1;
    } else {
      p.consecutiveMinus = 0;
      p.minusStreakAudioPlayed = false;
    }

    // Play minus streak audio if 3 consecutive minus
    if (p.consecutiveMinus >= 3 && !p.minusStreakAudioPlayed) {
      p.minusStreakAudioPlayed = true;
      setTimeout(() => {
        if (audioMinusMinus) playAudioFile(audioMinusMinus);
      }, 500);
    }
  });

  // Compute rank after
  const rankAfter = computeRanking(state.players);
  const scoresAfter = {};
  state.players.forEach(p => { scoresAfter[p.id] = p.score; });

  // Add to score history for chart
  state.scoreHistory.push({
    puteran: state.puteran,
    ronde: state.ronde,
    scores: state.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
  });

  // Add history entry
  state.history.unshift({
    ronde: state.ronde,
    puteran: state.puteran,
    type: 'scores',
    data: histScores
  });

  // Check fire candidates
  // Players that just exited recovery this puteran — they cannot burn each other this puteran
  // But they can still be burned by non-recovery players
  const justExitedRecovery = Object.keys(recoveryExiting).map(Number);

  const rawCandidates = computeFireCandidates(rankBefore, rankAfter, scoresBefore, scoresAfter, state.players);

  // Filter: if BOTH burner AND victim just exited recovery this puteran → skip
  const filteredCandidates = rawCandidates.filter(c => {
    const burnerJustExited = justExitedRecovery.includes(c.burnerId);
    const victimJustExited = justExitedRecovery.includes(c.victimId);
    // Both just exited → cannot burn each other
    if (burnerJustExited && victimJustExited) return false;
    return true;
  });

  state.fireCandidates = filteredCandidates;

  // Check achievements
  state.players.forEach(p => checkAchievements(p));

  // Update archive
  state.players.forEach(p => updateArchive(p));

  // AI comment
  state.aiComment = generateAIComment();

  // Save
  saveState();

  // Clear inputs
  inputs.forEach(inp => { inp.value = ''; });

  // Render immediately
  renderGame();

  // Check win
  const winners = state.players.filter(p => p.score >= state.target);
  if (winners.length > 0) {
    // Cancel any pending fire candidates — round ends
    state.fireCandidates = [];
    const winner = winners[0]; // take highest score
    winner.stars = (winner.stars || 0) + 1;
    winner.highestScore = Math.max(winner.highestScore || 0, winner.score);
    updateArchive(winner);
    saveState();
    renderGame();
    renderFireSection();
    await handleWin(winner);
    return;
  }

  // Show fire section if candidates
  renderFireSection();

  // If no fire candidates → run audio sequence directly
  if (filteredCandidates.length === 0) {
    await audioKocokKartu([]);
    await audioTotalSkor();
  }
  // If fire candidates → wait for user to confirm
}

// ============================================================
// CONFIRM FIRE
// ============================================================
async function confirmFire() {
  const candidates = [...state.fireCandidates];
  state.fireCandidates = [];
  renderFireSection();
  await executeFire(candidates);
  saveState();
  renderGame();
}

// ============================================================
// CANCEL FIRE
// ============================================================
function cancelFire() {
  state.fireCandidates = [];
  renderFireSection();
  saveState();
  showToast('Bakaran dibatalkan');
  // Still play audio sequence
  audioKocokKartu([]).then(() => audioTotalSkor());
}

// ============================================================
// RENDER FIRE SECTION
// ============================================================
function renderFireSection() {
  const section = document.getElementById('fire-section');
  if (!section) return;

  if (!state.fireCandidates || state.fireCandidates.length === 0) {
    section.innerHTML = '';
    return;
  }

  const candidates = state.fireCandidates;
  const listHTML = candidates.map(c => {
    const burner = state.players.find(p => p.id === c.burnerId);
    const victim = state.players.find(p => p.id === c.victimId);
    return `<li class="fire-candidate-item">🔥 <strong>${burner ? burner.name : '?'}</strong> membakar <strong>${victim ? victim.name : '?'}</strong></li>`;
  }).join('');

  const btnLabel = candidates.length > 1 ? '🔥 KONFIRMASI SEMUA' : '🔥 KONFIRMASI BAKAR';

  section.innerHTML = `
    <div class="fire-notification">
      <div class="fire-notification-title">🔥 BAKARAN TERDETEKSI!</div>
      <ul class="fire-candidate-list">${listHTML}</ul>
      <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
        <button class="btn-fire" onclick="confirmFire()">${btnLabel}</button>
        <button class="btn-secondary" onclick="cancelFire()">❌ Batalkan</button>
      </div>
    </div>
  `;
}

// ============================================================
// RENDER GAME SCREEN
// ============================================================
function renderGame() {
  if (state.screen !== 'game') return;

  // Ronde / Puteran info
  const rondeEl = document.getElementById('info-ronde');
  const puteranEl = document.getElementById('info-puteran');
  const targetEl = document.getElementById('info-target');
  if (rondeEl) rondeEl.querySelector('span').textContent = state.ronde;
  if (puteranEl) puteranEl.querySelector('span').textContent = state.puteran;
  if (targetEl) targetEl.querySelector('span').textContent = state.target;

  // Render player cards
  const grid = document.getElementById('players-cards-grid');
  if (grid) {
    const rankMap = computeRanking(state.players);
    grid.innerHTML = state.players.map(p => renderPlayerCard(p, rankMap[p.id])).join('');
  }

  // Render score inputs
  const inputGrid = document.getElementById('score-inputs-grid');
  if (inputGrid) {
    inputGrid.innerHTML = state.players.map(p => `
      <div class="score-input-group">
        <label class="score-input-label">${p.name}</label>
        <input type="number" class="score-input-field" data-id="${p.id}" placeholder="Skor..." inputmode="numeric">
      </div>
    `).join('');
  }

  // AI Comment
  const aiBox = document.getElementById('ai-comment-text');
  if (aiBox && state.aiComment) aiBox.textContent = state.aiComment;

  // Render tabs
  renderTabRanking();
  renderTabHistory();
  renderTabAchievement();
  renderTabStats();
  renderTabArchive();
  renderChart();
  renderFireSection();
}

function renderPlayerCard(player, rank) {
  const danger = getDangerLevel(player);
  const stars = '⭐'.repeat(player.stars || 0);
  const starsText = player.stars > 0 ? stars : '—';
  const scoreClass = player.score > 0 ? 'score-positive' : player.score < 0 ? 'score-negative' : 'score-zero';
  const minusThumb = player.score < 0 ? `<span class="minus-thumb">👎</span>` : '';
  const recoveryBadge = player.isInRecoveryMode ? `<span class="meta-chip chip-recovery">🔄 Recovery</span>` : '';

  const rankBadgeClass = ['', 'rank-badge-1', 'rank-badge-2', 'rank-badge-3', 'rank-badge-4'][rank] || 'rank-badge-4';
  const cardRankClass = rank <= 4 ? `rank-${rank}` : '';
  const dangerCardClass = danger.level === 'critical' || danger.level === 'danger' ? 'danger' : '';
  const recoveryCardClass = player.isInRecoveryMode ? 'in-recovery' : '';

  // Progress bar
  const pct = Math.max(0, Math.min(100, (player.score / state.target) * 100));
  const nearTarget = pct > 75;

  return `
    <div class="player-card ${cardRankClass} ${dangerCardClass} ${recoveryCardClass}" data-id="${player.id}">
      <div class="card-rank-badge ${rankBadgeClass}">#${rank}</div>
      <div class="card-player-name">${escHtml(player.name)}</div>
      <div class="card-score ${scoreClass}">${player.score} ${minusThumb}</div>
      <div class="target-progress">
        <div class="target-progress-fill ${nearTarget ? 'near' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="card-meta">
        <span class="meta-chip chip-stars">${starsText} ⭐${player.stars || 0}</span>
        <span class="meta-chip ${danger.cls}">${danger.label}</span>
        ${recoveryBadge}
        ${player.score < 0 ? `<span class="meta-chip chip-minus">👎 Minus</span>` : ''}
      </div>
    </div>
  `;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// TABS RENDERING
// ============================================================
function renderTabRanking() {
  const el = document.getElementById('tab-ranking-content');
  if (!el) return;
  const rankMap = computeRanking(state.players);
  const sorted = [...state.players].sort((a, b) => rankMap[a.id] - rankMap[b.id]);

  el.innerHTML = `<div class="ranking-list">${sorted.map(p => {
    const rank = rankMap[p.id];
    const badgeCls = ['','rank-badge-1','rank-badge-2','rank-badge-3','rank-badge-4'][rank] || 'rank-badge-4';
    const scoreColor = p.score >= 0 ? 'score-positive' : 'score-negative';
    return `
      <div class="ranking-item rank-pos-${rank}">
        <div class="ranking-pos ${badgeCls}">#${rank}</div>
        <div class="ranking-name">${escHtml(p.name)}</div>
        <div class="ranking-stars">${'⭐'.repeat(p.stars || 0)}</div>
        <div class="ranking-score ${scoreColor}">${p.score}</div>
        ${p.isInRecoveryMode ? '<span class="meta-chip chip-recovery" style="font-size:0.6rem;padding:0.15rem 0.35rem;">🔄 R</span>' : ''}
      </div>
    `;
  }).join('')}</div>`;
}

function renderTabHistory() {
  const el = document.getElementById('tab-history-content');
  if (!el) return;
  if (state.history.length === 0) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:0.85rem;text-align:center;padding:2rem;">Belum ada history</div>';
    return;
  }

  el.innerHTML = `<div class="history-list">${state.history.slice(0, 50).map(h => {
    if (h.type === 'fire') {
      return `
        <div class="history-item fire-event">
          <div class="history-round">🔥 R${h.ronde} · P${h.puteran}${h.isTriple ? ' · TRIPLE BURN!' : ''}</div>
          <div class="history-title">${escHtml(h.burnerName)} membakar ${escHtml(h.victimName)}</div>
        </div>
      `;
    }
    if (h.type === 'scores') {
      const scoresHtml = (h.data || []).map(s => {
        const cls = s.delta > 0 ? 'pos' : s.delta < 0 ? 'neg' : '';
        const sign = s.delta > 0 ? '+' : '';
        return `<span class="history-score-chip ${cls}">${escHtml(s.name)}: ${sign}${s.delta} (${s.total})</span>`;
      }).join('');
      return `
        <div class="history-item">
          <div class="history-round">R${h.ronde} · Puteran ${h.puteran}</div>
          <div class="history-scores">${scoresHtml}</div>
        </div>
      `;
    }
    return '';
  }).join('')}</div>`;
}

function renderTabAchievement() {
  const el = document.getElementById('tab-achievement-content');
  if (!el) return;

  // Gather all achievements across players
  const playerAchievements = {};
  state.players.forEach(p => {
    (p.achievements || []).forEach(a => {
      if (!playerAchievements[a]) playerAchievements[a] = [];
      playerAchievements[a].push(p.name);
    });
  });

  el.innerHTML = `<div class="achievement-grid">${ACHIEVEMENTS_DEF.map(def => {
    const unlocked = !!playerAchievements[def.id];
    const names = (playerAchievements[def.id] || []).join(', ');
    return `
      <div class="achievement-item ${unlocked ? 'unlocked' : ''}">
        <div class="achievement-icon">${def.icon}</div>
        <div class="achievement-name">${def.name}</div>
        <div class="achievement-desc">${def.desc}</div>
        ${unlocked ? `<div style="font-size:0.6rem;color:var(--gold);margin-top:0.3rem;">${escHtml(names)}</div>` : ''}
      </div>
    `;
  }).join('')}</div>`;
}

function renderTabStats() {
  const el = document.getElementById('tab-stats-content');
  if (!el) return;
  el.innerHTML = `<div class="stats-grid">${state.players.map(p => `
    <div class="stats-player-card">
      <div class="stats-player-name">${escHtml(p.name)}</div>
      <div class="stats-row">
        <div class="stat-cell"><div class="stat-val">${p.stars || 0}</div><div class="stat-lbl">Bintang</div></div>
        <div class="stat-cell"><div class="stat-val">${p.burns || 0}</div><div class="stat-lbl">Burns</div></div>
        <div class="stat-cell"><div class="stat-val">${p.burned || 0}</div><div class="stat-lbl">Burned</div></div>
        <div class="stat-cell"><div class="stat-val">${p.tripleBurn || 0}</div><div class="stat-lbl">Triple</div></div>
        <div class="stat-cell"><div class="stat-val">${p.highestScore || 0}</div><div class="stat-lbl">Highest</div></div>
        <div class="stat-cell"><div class="stat-val">${p.score}</div><div class="stat-lbl">Skor</div></div>
      </div>
    </div>
  `).join('')}</div>`;
}

function renderTabArchive() {
  const el = document.getElementById('tab-archive-content');
  if (!el) return;
  const archive = state.archive || {};
  const names = Object.keys(archive);
  if (names.length === 0) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:0.85rem;text-align:center;padding:2rem;">Belum ada arsip pemain</div>';
    return;
  }
  el.innerHTML = `<div class="archive-list">${names.map(name => {
    const a = archive[name];
    return `
      <div class="archive-item">
        <div class="archive-name">${escHtml(name)}</div>
        <div class="archive-stats">
          <span>⭐${a.stars || 0}</span>
          <span>🔥${a.burns || 0}</span>
          <span>💀${a.burned || 0}</span>
          <span>⚡${a.tripleBurn || 0}</span>
          <span>📈${a.highestScore || 0}</span>
        </div>
      </div>
    `;
  }).join('')}</div>`;
}

// ============================================================
// CHART
// ============================================================
const CHART_COLORS = ['#c9a227', '#a8a9ad', '#e63946', '#2a9d8f'];

function renderChart() {
  const canvas = document.getElementById('score-chart-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const history = state.scoreHistory;

  const W = canvas.offsetWidth || 340;
  const H = 260;
  canvas.width = W;
  canvas.height = H;

  ctx.clearRect(0, 0, W, H);

  if (history.length < 1) {
    ctx.fillStyle = 'rgba(201,162,39,0.3)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Belum ada data', W / 2, H / 2);
    return;
  }

  const PAD = { top: 20, right: 20, bottom: 30, left: 45 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // All scores
  let allScores = [];
  history.forEach(h => h.scores.forEach(s => allScores.push(s.score)));
  // Add 0 and target
  allScores.push(0, state.target);
  const minScore = Math.min(...allScores);
  const maxScore = Math.max(...allScores);
  const range = maxScore - minScore || 1;

  function toX(i) { return PAD.left + (i / Math.max(1, history.length - 1)) * chartW; }
  function toY(val) { return PAD.top + chartH - ((val - minScore) / range) * chartH; }

  // Grid lines
  ctx.strokeStyle = 'rgba(201,162,39,0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + chartW, y);
    ctx.stroke();
    const val = Math.round(maxScore - (range / 4) * i);
    ctx.fillStyle = 'rgba(201,162,39,0.5)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val, PAD.left - 4, y + 3);
  }

  // Target line
  const targetY = toY(state.target);
  ctx.strokeStyle = 'rgba(201,162,39,0.5)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD.left, targetY);
  ctx.lineTo(PAD.left + chartW, targetY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(201,162,39,0.8)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('TARGET', PAD.left + 2, targetY - 3);

  // Zero line
  if (minScore < 0) {
    const zeroY = toY(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, zeroY);
    ctx.lineTo(PAD.left + chartW, zeroY);
    ctx.stroke();
  }

  // Lines per player
  state.players.forEach((player, pi) => {
    const color = CHART_COLORS[pi % CHART_COLORS.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((h, i) => {
      const scoreEntry = h.scores.find(s => s.id === player.id);
      const score = scoreEntry ? scoreEntry.score : 0;
      const x = toX(i);
      const y = toY(score);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots
    history.forEach((h, i) => {
      const scoreEntry = h.scores.find(s => s.id === player.id);
      const score = scoreEntry ? scoreEntry.score : 0;
      const x = toX(i);
      const y = toY(score);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  });

  // X axis labels
  ctx.fillStyle = 'rgba(201,162,39,0.5)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  history.forEach((h, i) => {
    if (i % Math.max(1, Math.floor(history.length / 6)) === 0) {
      ctx.fillText(`P${h.puteran}`, toX(i), H - 8);
    }
  });

  // Legend
  const legend = document.getElementById('chart-legend');
  if (legend) {
    legend.innerHTML = state.players.map((p, i) => `
      <div class="legend-item">
        <div class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></div>
        <span>${escHtml(p.name)}</span>
      </div>
    `).join('');
  }
}

// ============================================================
// SHOW SCREEN
// ============================================================
function showScreen(screenName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${screenName}`);
  if (target) target.classList.add('active');
  state.screen = screenName;
  // Show screenshot button only in game
  const btnSS = document.getElementById('btn-screenshot');
  if (btnSS) btnSS.style.display = screenName === 'game' ? 'flex' : 'none';
}

// ============================================================
// SETUP SCREEN
// ============================================================
function initSetupScreen() {
  // Load archived names into inputs if available
  const arch = Object.keys(state.archive || {});
  const inputs = document.querySelectorAll('.player-name-input');
  inputs.forEach((inp, i) => {
    if (arch[i]) inp.value = arch[i];
    inp.value = inp.value || '';
  });
}

function startGame() {
  const nameInputs = document.querySelectorAll('.player-name-input');
  const names = [];
  nameInputs.forEach(inp => {
    const name = inp.value.trim();
    if (!name) { showToast('Isi semua nama pemain!', 'fire'); return; }
    names.push(name);
  });
  if (names.length < 4) { showToast('Isi semua nama pemain!', 'fire'); return; }

  const targetSelect = document.getElementById('target-select');
  const targetCustom = document.getElementById('target-custom');
  let target = parseInt(targetSelect.value);
  if (targetSelect.value === 'custom') {
    target = parseInt(targetCustom.value);
    if (isNaN(target) || target < 100) { showToast('Target custom minimal 100!', 'fire'); return; }
  }

  // Build players — load existing stats from archive
  state.players = names.map((name, i) => {
    const arch = (state.archive || {})[name] || {};
    return {
      id: i + 1,
      name,
      score: 0,
      stars: arch.stars || 0,
      burns: arch.burns || 0,
      burned: arch.burned || 0,
      tripleBurn: arch.tripleBurn || 0,
      highestScore: arch.highestScore || 0,
      achievements: arch.achievements || [],
      isInRecoveryMode: false,
      recoveryStartPuteran: null,
      consecutiveMinus: 0,
      minusStreakAudioPlayed: false
    };
  });

  state.ronde = 1;
  state.puteran = 0;
  state.target = target;
  state.history = [];
  state.fireCandidates = [];
  state.scoreHistory = [];
  state.aiComment = `🎮 Ronde 1 dimulai! Target ${target} poin. Semangat!`;
  state.undoStack = [];
  state.gameActive = true;

  saveState();
  showScreen('game');
  renderGame();

  // Play start TTS
  speak('Permainan dimulai');
}

// ============================================================
// ROUND NEW
// ============================================================
function showRoundNew() {
  showScreen('round-new');
  renderRoundNew();
}

function renderRoundNew() {
  const el = document.getElementById('round-new-content');
  if (!el) return;
  el.innerHTML = `
    <div class="round-new-card">
      <div style="text-align:center;margin-bottom:1.5rem;">
        <img src="joker.png" style="width:60px;height:60px;object-fit:contain;filter:drop-shadow(0 0 10px rgba(201,162,39,0.7));animation:floatAnim 3s ease-in-out infinite;">
        <div class="setup-title" style="margin-top:0.5rem;">Ronde ${state.ronde} Selesai!</div>
        <div class="setup-sub">Mulai Ronde ${state.ronde + 1}</div>
      </div>
      <div style="margin-bottom:1rem;">
        <div class="form-label">Pemain Saat Ini</div>
        ${state.players.map((p, i) => `
          <div class="form-group" style="display:flex;align-items:center;gap:0.5rem;">
            <span style="color:var(--text-secondary);font-size:0.78rem;min-width:20px;">${i+1}.</span>
            <input type="text" class="form-input round-new-name" data-id="${p.id}" value="${escHtml(p.name)}" placeholder="Nama pemain ${i+1}">
          </div>
        `).join('')}
      </div>
      <div class="form-group">
        <label class="form-label">Target Kemenangan</label>
        <select class="form-select" id="round-new-target">
          <option value="500" ${state.target===500?'selected':''}>500</option>
          <option value="750" ${state.target===750?'selected':''}>750</option>
          <option value="1000" ${state.target===1000?'selected':''}>1000</option>
          <option value="1500" ${state.target===1500?'selected':''}>1500</option>
          <option value="custom">Custom</option>
        </select>
        <input type="number" class="form-input" id="round-new-custom" placeholder="Target custom..." style="margin-top:0.5rem;display:none;" min="100">
      </div>
      <button class="btn-primary" onclick="startNewRound()" style="margin-top:0.5rem;">▶ MULAI RONDE BARU</button>
    </div>
  `;

  const sel = document.getElementById('round-new-target');
  const customInp = document.getElementById('round-new-custom');
  if (sel && customInp) {
    sel.addEventListener('change', () => {
      customInp.style.display = sel.value === 'custom' ? 'block' : 'none';
    });
  }
}

function startNewRound() {
  const nameInputs = document.querySelectorAll('.round-new-name');
  const names = [];
  nameInputs.forEach(inp => names.push(inp.value.trim() || inp.dataset.name));

  const targetSel = document.getElementById('round-new-target');
  const targetCustom = document.getElementById('round-new-custom');
  let target = parseInt(targetSel.value);
  if (targetSel.value === 'custom') {
    target = parseInt(targetCustom.value);
    if (isNaN(target) || target < 100) { showToast('Target custom minimal 100!', 'fire'); return; }
  }

  // Update names
  state.players.forEach((p, i) => {
    if (names[i]) p.name = names[i];
  });

  // Reset round state
  state.ronde++;
  state.puteran = 0;
  state.target = target;
  state.fireCandidates = [];
  state.history = [];
  state.scoreHistory = [];
  state.aiComment = `🎮 Ronde ${state.ronde} dimulai! Target ${target} poin.`;

  // Reset player scores (keep stats)
  state.players.forEach(p => {
    p.score = 0;
    p.isInRecoveryMode = false;
    p.recoveryStartPuteran = null;
    p.consecutiveMinus = 0;
    p.minusStreakAudioPlayed = false;
  });

  // Update archive
  state.players.forEach(p => updateArchive(p));
  saveState();

  showScreen('game');
  renderGame();
  speak('Permainan dimulai');
}

// ============================================================
// EDIT NAMES
// ============================================================
function showEditNames() {
  const modal = document.getElementById('modal-edit-names');
  if (!modal) return;
  const form = document.getElementById('edit-names-form');
  if (form) {
    form.innerHTML = state.players.map(p => `
      <div class="form-group">
        <label class="form-label">Pemain ${p.id}</label>
        <input type="text" class="form-input edit-name-input" data-id="${p.id}" value="${escHtml(p.name)}" maxlength="20">
      </div>
    `).join('');
  }
  modal.classList.add('active');
}

function saveEditNames() {
  const inputs = document.querySelectorAll('.edit-name-input');
  inputs.forEach(inp => {
    const id = parseInt(inp.dataset.id);
    const newName = inp.value.trim();
    if (!newName) return;
    const player = state.players.find(p => p.id === id);
    if (player) {
      // Move archive
      if (player.name !== newName && state.archive[player.name]) {
        const old = state.archive[player.name];
        if (!state.archive[newName]) state.archive[newName] = old;
        else {
          // Merge
          const arch = state.archive[newName];
          arch.stars = Math.max(arch.stars || 0, old.stars || 0);
          arch.burns = Math.max(arch.burns || 0, old.burns || 0);
          arch.burned = Math.max(arch.burned || 0, old.burned || 0);
          arch.tripleBurn = Math.max(arch.tripleBurn || 0, old.tripleBurn || 0);
          arch.highestScore = Math.max(arch.highestScore || 0, old.highestScore || 0);
        }
      }
      player.name = newName;
    }
  });
  saveState();
  renderGame();
  closeModal('modal-edit-names');
  showToast('Nama berhasil diperbarui');
}

// ============================================================
// SCREENSHOT
// ============================================================
function takeScreenshot() {
  // Use html2canvas if available, else fallback
  const el = document.getElementById('screen-game');
  if (!el) return;
  showToast('📸 Screenshot tersimpan (gunakan fitur screenshot OS)');
  // Attempt native share/screenshot
  if (navigator.share) {
    // Just notify user
    showToast('Gunakan tombol screenshot di perangkat Anda');
  }
}

// ============================================================
// FULLSCREEN
// ============================================================
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// ============================================================
// RESET GAME
// ============================================================
function showResetConfirm() {
  document.getElementById('modal-reset').classList.add('active');
}

function doReset() {
  stopAllAudio();
  closeModal('modal-reset');

  // Save stats before reset
  state.players.forEach(p => updateArchive(p));

  // Reset game state only
  state.screen = 'setup';
  state.ronde = 1;
  state.puteran = 0;
  state.fireCandidates = [];
  state.history = [];
  state.scoreHistory = [];
  state.aiComment = '';
  state.undoStack = [];
  state.gameActive = false;

  // Reset player scores only
  state.players.forEach(p => {
    p.score = 0;
    p.isInRecoveryMode = false;
    p.recoveryStartPuteran = null;
    p.consecutiveMinus = 0;
    p.minusStreakAudioPlayed = false;
  });
  state.players = [];

  saveState();
  showScreen('setup');
  initSetupScreen();
}

// ============================================================
// MODAL
// ============================================================
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  const panel = document.getElementById(`tab-${tabName}`);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');

  if (tabName === 'grafik') setTimeout(() => renderChart(), 50);
}

// ============================================================
// LIGHT MODE
// ============================================================
function toggleLightMode() {
  document.body.classList.toggle('light-mode');
  localStorage.setItem('scoreCekih_lightMode', document.body.classList.contains('light-mode') ? '1' : '0');
}

// ============================================================
// LOADING SCREEN
// ============================================================
function runLoadingScreen() {
  const bar = document.getElementById('loading-bar');
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 20 + 5;
    if (progress > 95) progress = 95;
    if (bar) bar.style.width = progress + '%';
  }, 200);

  return new Promise(resolve => {
    setTimeout(() => {
      clearInterval(interval);
      if (bar) bar.style.width = '100%';
      setTimeout(() => {
        const ls = document.getElementById('loading-screen');
        if (ls) {
          ls.classList.add('fade-out');
          setTimeout(() => {
            ls.style.display = 'none';
            resolve();
          }, 600);
        } else {
          resolve();
        }
      }, 400);
    }, 2000);
  });
}

// ============================================================
// MAIN INIT
// ============================================================
async function init() {
  initAudio();

  // Loading screen
  await runLoadingScreen();

  // Load state from localStorage
  const hasState = loadState();

  // Light mode
  if (localStorage.getItem('scoreCekih_lightMode') === '1') {
    document.body.classList.add('light-mode');
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Restore screen
  if (hasState && state.gameActive) {
    if (state.screen === 'game') {
      showScreen('game');
      renderGame();
    } else if (state.screen === 'round-new') {
      showScreen('round-new');
      renderRoundNew();
    } else {
      showScreen('setup');
      initSetupScreen();
    }
  } else {
    showScreen('setup');
    initSetupScreen();
  }

  // Event listeners
  setupEventListeners();
}

function setupEventListeners() {
  // Target select
  const targetSel = document.getElementById('target-select');
  const targetCustom = document.getElementById('target-custom');
  if (targetSel && targetCustom) {
    targetSel.addEventListener('change', () => {
      targetCustom.style.display = targetSel.value === 'custom' ? 'block' : 'none';
    });
  }

  // Keyboard: Enter to save puteran
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && state.screen === 'game') {
      const inputs = document.querySelectorAll('.score-input-field');
      const focused = document.activeElement;
      const isInInput = [...inputs].some(inp => inp === focused);
      if (isInInput) savePuteran();
    }
  });

  // Tab bar
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ============================================================
// DOM READY
// ============================================================
document.addEventListener('DOMContentLoaded', init);
