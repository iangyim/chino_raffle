import { useState, useRef } from "react";
import confetti from "canvas-confetti";
import "./App.css";

// ── Synth fanfare (fallback when no MP3 clips are loaded) ──────────────────────
function playFanfare() {
  try {
    const ctx    = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createDynamicsCompressor();
    master.connect(ctx.destination);
    const vol = ctx.createGain();
    vol.gain.value = 0.55;
    vol.connect(master);
    const melody  = [
      { freq: 523.25, t: 0.00, dur: 0.14 },
      { freq: 659.25, t: 0.14, dur: 0.14 },
      { freq: 783.99, t: 0.28, dur: 0.14 },
      { freq: 1046.5, t: 0.42, dur: 0.75 },
    ];
    const harmony = [
      { freq: 392.00, t: 0.00, dur: 0.14 },
      { freq: 523.25, t: 0.14, dur: 0.14 },
      { freq: 587.33, t: 0.28, dur: 0.14 },
      { freq: 783.99, t: 0.42, dur: 0.75 },
    ];
    [...melody, ...harmony].forEach(({ freq, t, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(vol);
      const s = ctx.currentTime + t;
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.5, s + 0.025);
      gain.gain.setValueAtTime(0.5, s + dur * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, s + dur);
      osc.start(s);
      osc.stop(s + dur + 0.05);
    });
  } catch (_) {}
}

// ── Reel constants ─────────────────────────────────────────────────────────────
const ITEM_H        = 80;
const VISIBLE       = 5;
const HALF          = Math.floor(VISIBLE / 2);
const N_ROTATIONS   = 12;
const SPIN_DURATION = 8000;

const FAST_T = 5 / 8;
const FAST_F = (3 * FAST_T) / (1 + 2 * FAST_T);

function easeSlot(t) {
  if (t <= FAST_T) return (t / FAST_T) * FAST_F;
  const t2 = (t - FAST_T) / (1 - FAST_T);
  return FAST_F + (1 - FAST_F) * (1 - Math.pow(1 - t2, 3));
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function App() {
  const [names,         setNames]         = useState([]);
  const [winners,       setWinners]       = useState([]);
  const [input,         setInput]         = useState("");
  const [phase,         setPhase]         = useState("setup");
  const [currentWinner, setCurrentWinner] = useState("");
  const [pixelOffset,   setPixelOffset]   = useState(0);
  const [muted,         setMuted]         = useState(false);
  const [clips,         setClips]         = useState([]);
  const [showMusic,     setShowMusic]     = useState(false);

  const rafRef       = useRef(null);
  const fileRef      = useRef(null);
  const clipFileRef  = useRef(null);
  const audioRef     = useRef(null);      // winner MP3 Audio instance
  const mutedRef     = useRef(false);     // mirror of muted for use in rAF closures
  const lastClipRef  = useRef(null);      // url of last played clip (no-repeat logic)
  const spinCtxRef   = useRef(null);      // AudioContext for spin tick sounds
  const tickBufRef   = useRef(null);      // pre-baked short noise burst buffer
  const lastTickRef  = useRef(-1);        // last centerIdx that produced a tick

  // ── Mute toggle ────────────────────────────────────────────────────────────
  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) stopAudio();
  };

  // ── Name management ────────────────────────────────────────────────────────
  const addName = () => {
    const t = input.trim();
    if (!t) return;
    if (new Set([...names, ...winners]).has(t)) return;
    setNames(prev => [...prev, t]);
    setInput("");
  };
  const removeName = name => setNames(prev => prev.filter(n => n !== name));
  const handleKey  = e => { if (e.key === "Enter") addName(); };

  const handleTxtUpload = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const taken    = new Set([...names, ...winners]);
      const incoming = ev.target.result
        .split("\n").map(l => l.trim()).filter(l => l && !taken.has(l));
      setNames(prev => [...prev, ...new Set(incoming)]);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Music clip management ──────────────────────────────────────────────────
  const handleClipUpload = e => {
    const files = Array.from(e.target.files);
    const newClips = files.map(f => ({ name: f.name, url: URL.createObjectURL(f) }));
    setClips(prev => [...prev, ...newClips]);
    e.target.value = "";
  };

  const removeClip = url => {
    URL.revokeObjectURL(url);
    setClips(prev => prev.filter(c => c.url !== url));
    if (lastClipRef.current === url) lastClipRef.current = null;
  };

  // ── Winner audio ───────────────────────────────────────────────────────────
  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  };

  const playWinnerSound = (currentClips) => {
    if (mutedRef.current) return;
    if (currentClips.length > 0) {
      // Avoid repeating the same clip back-to-back when 2+ are loaded
      const pool = currentClips.length > 1
        ? currentClips.filter(c => c.url !== lastClipRef.current)
        : currentClips;
      const clip  = pool[Math.floor(Math.random() * pool.length)];
      lastClipRef.current = clip.url;
      const audio = new Audio(clip.url);
      audioRef.current   = audio;
      audio.play().catch(() => {});
    } else {
      playFanfare();
    }
  };

  // ── Spin tick sounds ───────────────────────────────────────────────────────
  const startSpinSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      spinCtxRef.current = ctx;

      // Pre-bake a 25 ms noise burst with exponential envelope.
      // Reusing the buffer avoids allocation inside the hot rAF loop.
      const sr      = ctx.sampleRate;
      const len     = Math.floor(sr * 0.025);
      const buf     = ctx.createBuffer(1, len, sr);
      const data    = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.25));
      }
      tickBufRef.current = buf;
    } catch (_) {}
    lastTickRef.current = -1;
  };

  const stopSpinSound = () => {
    if (spinCtxRef.current) {
      spinCtxRef.current.close().catch(() => {});
      spinCtxRef.current = null;
    }
    tickBufRef.current  = null;
    lastTickRef.current = -1;
  };

  // Soft "tok" on every name that crosses the centre bracket.
  // Two layers:
  //   1. Sine with a fast pitch-drop (300 → 120 Hz) — the warm body of the click
  //   2. Low-passed noise burst — the tactile "snap" transient
  const maybeTick = (centerIdx) => {
    if (mutedRef.current || !spinCtxRef.current) return;
    if (centerIdx === lastTickRef.current) return;
    lastTickRef.current = centerIdx;
    try {
      const ctx = spinCtxRef.current;
      const now = ctx.currentTime;

      // ── Layer 1: pitched body ──────────────────────────────────────────
      const osc  = ctx.createOscillator();
      const oGain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(320 + Math.random() * 40, now);   // 320–360 Hz
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.055);   // drops to 90 Hz
      osc.connect(oGain);
      oGain.connect(ctx.destination);
      oGain.gain.setValueAtTime(0.22, now);
      oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.start(now);
      osc.stop(now + 0.08);

      // ── Layer 2: noise transient ───────────────────────────────────────
      if (tickBufRef.current) {
        const src   = ctx.createBufferSource();
        const lpf   = ctx.createBiquadFilter();
        const nGain = ctx.createGain();
        lpf.type = "lowpass";
        lpf.frequency.value = 2200;  // keep it mellow, cut the harshness
        nGain.gain.value = 0.12;
        src.buffer = tickBufRef.current;
        src.connect(lpf);
        lpf.connect(nGain);
        nGain.connect(ctx.destination);
        src.start(now);
      }
    } catch (_) {}
  };

  // ── Spin ───────────────────────────────────────────────────────────────────
  const spin = async () => {
    if (!names.length) return;
    cancelAnimationFrame(rafRef.current);
    stopAudio();
    stopSpinSound();
    setPixelOffset(0);
    setPhase("spinning");
    startSpinSound();

    // Snapshot clips now so the closure uses a stable reference
    const clipsSnapshot = [...clips];

    const res = await fetch("http://localhost:8000/api/raffle", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ names }),
    });
    const { winner: picked } = await res.json();

    const n         = names.length;
    const winnerIdx = names.indexOf(picked);
    const totalDist = (N_ROTATIONS * n + winnerIdx) * ITEM_H;
    const startTime = performance.now();

    const animate = now => {
      const t      = Math.min((now - startTime) / SPIN_DURATION, 1);
      const offset = totalDist * easeSlot(t);
      setPixelOffset(offset);

      // Tick on every new name crossing the centre
      maybeTick(Math.floor(offset / ITEM_H));

      if (t >= 1) {
        setPixelOffset(totalDist);
        stopSpinSound();
        setCurrentWinner(picked);
        setPhase("winner");
        celebrate();
        playWinnerSound(clipsSnapshot);
        return;
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
  };

  // ── Confetti ───────────────────────────────────────────────────────────────
  const celebrate = () => {
    const end    = Date.now() + 3500;
    const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#c77dff"];
    const frame  = () => {
      confetti({ particleCount: 7, angle: 60,  spread: 55, origin: { x: 0 }, colors });
      confetti({ particleCount: 7, angle: 120, spread: 55, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  };

  // ── Next draw / finish ─────────────────────────────────────────────────────
  const goAgain = () => {
    cancelAnimationFrame(rafRef.current);
    stopAudio();
    stopSpinSound();
    setNames(prev => prev.filter(n => n !== currentWinner));
    setWinners(prev => [...prev, currentWinner]);
    setCurrentWinner("");
    setPhase("setup");
  };

  const resetAll = () => {
    cancelAnimationFrame(rafRef.current);
    stopAudio();
    stopSpinSound();
    setNames([...names, ...winners, currentWinner].filter(Boolean));
    setWinners([]);
    setCurrentWinner("");
    setPhase("setup");
    setPixelOffset(0);
  };

  // ── Reel renderer ──────────────────────────────────────────────────────────
  const renderReel = reelNames => {
    if (!reelNames.length) return null;
    const n          = reelNames.length;
    const centerIdx  = Math.floor(pixelOffset / ITEM_H);
    const subOffset  = pixelOffset % ITEM_H;
    const centreSlot = subOffset < ITEM_H / 2 ? 0 : 1;
    const translateY = -(ITEM_H + subOffset);

    const items = [];
    for (let i = -(HALF + 1); i <= HALF + 1; i++) {
      const nameIdx = ((centerIdx + i) % n + n) % n;
      items.push({ name: reelNames[nameIdx], slot: i });
    }

    return (
      <div className="slot-window">
        <div className="slot-strip" style={{ transform: `translateY(${translateY}px)` }}>
          {items.map((item, j) => (
            <div
              key={j}
              className={`slot-item${item.slot === centreSlot ? " slot-center" : ""}`}
              style={{ opacity: Math.max(0.12, 1 - Math.abs(item.slot - centreSlot * 0.5) * 0.28) }}
            >
              {item.name}
            </div>
          ))}
        </div>
        <div className="slot-highlight" />
      </div>
    );
  };

  const displayedWinners = currentWinner ? [...winners, currentWinner] : winners;
  const isSetup = phase === "setup";

  return (
    <div className="app">

      {/* ── Top-right controls ── */}
      <div className="top-controls">
        {/* 🎵 only visible in setup so contestants don't see the clip list */}
        {isSetup && (
          <button
            className={`icon-btn${showMusic ? " active" : ""}`}
            onClick={() => setShowMusic(s => !s)}
            title="Music clips"
          >
            🎵
            {clips.length > 0 && <span className="clip-badge">{clips.length}</span>}
          </button>
        )}
        <button className="icon-btn" onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      <h1 className="title">🎟 Raffle</h1>

      {/* ── Music panel (setup only) ── */}
      {isSetup && showMusic && (
        <div className="music-panel">
          <div className="music-panel-header">
            <span>Winner music clips</span>
            <button className="btn btn-upload" onClick={() => clipFileRef.current.click()}>
              + Add MP3s
            </button>
            <input
              ref={clipFileRef}
              type="file"
              accept="audio/mpeg,.mp3"
              multiple
              hidden
              onChange={handleClipUpload}
            />
          </div>

          {clips.length === 0 ? (
            <p className="music-empty">No clips loaded — synth fanfare will play instead.</p>
          ) : (
            <ul className="clip-list">
              {clips.map(clip => (
                <li key={clip.url} className="clip-item">
                  <span className="clip-icon">♪</span>
                  <span className="clip-name">{clip.name}</span>
                  <button className="remove-btn" onClick={() => removeClip(clip.url)}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Setup ── */}
      {isSetup && (
        <div className="setup">
          <div className="input-row">
            <input
              className="name-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Enter a name..."
              autoFocus
            />
            <button className="btn btn-add" onClick={addName}>Add</button>
            <button className="btn btn-upload" onClick={() => fileRef.current.click()}>
              Upload .txt
            </button>
            <input ref={fileRef} type="file" accept=".txt" hidden onChange={handleTxtUpload} />
          </div>

          <ul className="name-list">
            {names.map(name => (
              <li key={name} className="name-tag">
                <span>{name}</span>
                <button className="remove-btn" onClick={() => removeName(name)}>✕</button>
              </li>
            ))}
          </ul>

          {names.length > 0 ? (
            <button className="btn btn-spin" onClick={spin}>
              Start Raffle — {names.length} {names.length === 1 ? "contestant" : "contestants"}
            </button>
          ) : winners.length > 0 ? (
            <div className="empty-state">
              <p>🎉 Everyone has won!</p>
              <button className="btn btn-spin" onClick={resetAll}>Start Over</button>
            </div>
          ) : (
            <p className="hint">Add contestants or upload a .txt file to begin.</p>
          )}
        </div>
      )}

      {/* ── Spinning ── */}
      {phase === "spinning" && (
        <div className="spinning">
          <p className="spin-label">Drawing…</p>
          {renderReel(names)}
        </div>
      )}

      {/* ── Winner ── */}
      {phase === "winner" && (
        <div className="winner-screen">
          <p className="winner-label">Winner!</p>
          {renderReel(names)}
          <button className="btn btn-spin" onClick={goAgain}>
            {names.length > 1 ? "Next Draw" : "Finish"}
          </button>
        </div>
      )}

      {/* ── Past winners ── */}
      {displayedWinners.length > 0 && (
        <div className="winners-history">
          <h2>Past Winners</h2>
          <ol>
            {displayedWinners.map((name, i) => (
              <li key={i} className={name === currentWinner ? "current-winner-entry" : ""}>
                {name}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
