import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────
const STORAGE_KEY = "babysense_log";
const PROFILE_KEY = "babysense_profile";
const API_KEY     = import.meta.env.VITE_GEMINI_KEY;

const EVENT_TYPES = [
  { type: "feed",       label: "Feed",        icon: "fa-solid fa-bottle-droplet", streak: "#FF6B6B", hasTimer: true,  hasDiaperType: false },
  { type: "sleep",      label: "Sleep",       icon: "fa-solid fa-moon",           streak: "#6B8CFF", hasTimer: true,  hasDiaperType: false },
  { type: "diaper",     label: "Diaper",      icon: "fa-solid fa-baby",           streak: "#FFD93D", hasTimer: false, hasDiaperType: true  },
  { type: "cry",        label: "Cry",         icon: "fa-solid fa-face-sad-tear",  streak: "#6BCB77", hasTimer: true,  hasDiaperType: false },
  { type: "tummytime",  label: "Tummy Time",  icon: "fa-solid fa-child-reaching", streak: "#FF9F43", hasTimer: true,  hasDiaperType: false },
];

// ─── Helpers ──────────────────────────────────────────────────────────
function timeSince(date) {
  if (!date) return "never";
  const mins = Math.floor((Date.now() - date) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 1) return null;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatLiveDuration(startTime) {
  const secs = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function getAge(dob, format) {
  if (!dob) return null;
  const diff   = Date.now() - new Date(dob).getTime();
  const days   = Math.floor(diff / 86400000);
  const weeks  = Math.floor(days / 7);
  const months = Math.floor(days / 30.44);
  const years  = Math.floor(days / 365.25);
  switch (format) {
    case "Days":   return `${days}d old`;
    case "Months": return `${months}mo old`;
    case "Years":  return `${years}y old`;
    default:       return `${weeks}w old`;
  }
}

function isNightTime() { const h = new Date().getHours(); return h >= 21 || h < 6; }
function loadLog()     { try { return JSON.parse(localStorage.getItem(STORAGE_KEY))  || []; } catch { return []; } }
function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch { return {}; } }

// ─── Theme ────────────────────────────────────────────────────────────
function getAccent(gender) {
  if (gender === "Girl")               return "#FF6B9D";
  if (gender === "Prefer not to say")  return "#C4956A";
  return "#6B8CFF";
}

function getTheme(dark, gender) {
  const accent = getAccent(gender);
  return dark ? {
    bg: "#0d0d14", bg2: "#16161f", bg3: "#1e1e2e",
    card: "#16161f", border: "#22223a", text: "#f0f0f8",
    textSub: accent, textMuted: "#666", textFaint: "#333",
    accent, shadow: `${accent}33`, tabBg: "#0d0d14", tabBorder: "#1e1e2e",
  } : {
    bg: "#f7f7fc", bg2: "#ffffff", bg3: "#eeeef8",
    card: "#ffffff", border: "#e8e8f4", text: "#1a1a2e",
    textSub: accent, textMuted: "#999", textFaint: "#ccc",
    accent, shadow: `${accent}22`, tabBg: "#ffffff", tabBorder: "#e8e8f4",
  };
}

// ─── AI ───────────────────────────────────────────────────────────────
async function getAIPrediction(log, profile) {
  if (!API_KEY)       return "⚠️ API key not set.";
  if (log.length < 2) return "Log a few more events and I'll start predicting patterns.";

  const summary = log.slice(0, 20).map(e => {
    const mins = Math.floor((Date.now() - e.startTime) / 60000);
    const dur  = e.duration ? ` for ${formatDuration(e.duration)}` : "";
    const extra = e.diaperType ? ` (${e.diaperType})` : e.side ? ` (${e.side} side)` : "";
    return `${e.label}${extra}${dur} — ${mins}min ago`;
  }).join("; ");

  const age = getAge(profile.dob, "Weeks");
  const ctx = profile.nickname
    ? `Baby: ${profile.nickname}, ${age || "age unknown"}, ${profile.gender || "unknown gender"}, ${profile.feedingType || "unknown feeding"}, in ${profile.city || "unknown city"}. Notes: ${profile.notes || "none"}.`
    : "";

  const prompt = `You are a warm, expert baby care assistant. ${ctx}
Recent events with durations (most recent first): ${summary}.
Based on duration patterns and timing, predict:
1. What the baby likely needs next
2. Approximately when
3. If crying is logged, suggest the most likely reason based on the pattern
Be specific, warm, and concise — max 3 sentences. No intro phrases.`;

  try {
    const res  = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 150, temperature: 0.7 } }),
    });
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Analyzing patterns...";
  } catch { return "Couldn't reach AI — check connection."; }
}

// ─── Diaper Modal ─────────────────────────────────────────────────────
function DiaperModal({ t, onSave, onClose }) {
  const [diaperType, setDiaperType] = useState(null);
  const [pastMode,   setPastMode]   = useState(false);
  const [pastTime,   setPastTime]   = useState("");
  const [note,       setNote]       = useState("");

  function handleSave() {
    if (!diaperType) return;
    const time = pastMode && pastTime ? new Date(pastTime).getTime() : Date.now();
    onSave({ diaperType, startTime: time, note });
  }

  const typeBtn = (type, label, color) => (
    <button onClick={() => setDiaperType(type)} style={{
      flex: 1, padding: "14px 8px", borderRadius: 14, border: `2px solid ${diaperType === type ? color : t.border}`,
      background: diaperType === type ? `${color}18` : t.bg3,
      color: diaperType === type ? color : t.textMuted,
      fontWeight: "700", fontSize: 14, cursor: "pointer", fontFamily: "'Poppins', sans-serif",
      transition: "all 0.15s",
    }}>{label}</button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: t.bg2, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 420 }}>
        <div style={{ fontSize: 17, fontWeight: "700", marginBottom: 20, color: t.text }}>
          <i className="fa-solid fa-baby" style={{ marginRight: 10, color: "#FFD93D" }} />
          Log Diaper Change
        </div>

        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Type</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {typeBtn("Wet",   "Wet",   "#6B8CFF")}
          {typeBtn("Dirty", "Dirty", "#FF6B6B")}
          {typeBtn("Both",  "Both",  "#FFD93D")}
        </div>

        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>When</div>
        <div style={{ display: "flex", gap: 10, marginBottom: pastMode ? 12 : 20 }}>
          <button onClick={() => setPastMode(false)} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `2px solid ${!pastMode ? t.accent : t.border}`, background: !pastMode ? `${t.accent}18` : t.bg3, color: !pastMode ? t.accent : t.textMuted, fontWeight: "600", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Now</button>
          <button onClick={() => setPastMode(true)}  style={{ flex: 1, padding: "10px", borderRadius: 12, border: `2px solid ${pastMode  ? t.accent : t.border}`, background: pastMode  ? `${t.accent}18` : t.bg3, color: pastMode  ? t.accent : t.textMuted, fontWeight: "600", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>In the past</button>
        </div>
        {pastMode && (
          <input type="datetime-local" value={pastTime} onChange={e => setPastTime(e.target.value)}
            style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 16 }} />
        )}

        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Note (optional)</div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Any observations..."
          style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 20 }} />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 14, border: `1px solid ${t.border}`, background: t.bg3, color: t.textMuted, fontWeight: "600", fontSize: 15, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Cancel</button>
          <button onClick={handleSave} disabled={!diaperType} style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: diaperType ? "#FFD93D" : t.bg3, color: diaperType ? "#1a1a2e" : t.textMuted, fontWeight: "700", fontSize: 15, cursor: diaperType ? "pointer" : "default", fontFamily: "'Poppins', sans-serif" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Timer Modal ──────────────────────────────────────────────────────
function TimerModal({ ev, t, onSave, onClose }) {
  const [mode,      setMode]      = useState("now");   // now | past | timer
  const [running,   setRunning]   = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [elapsed,   setElapsed]   = useState(0);
  const [pastStart, setPastStart] = useState("");
  const [pastEnd,   setPastEnd]   = useState("");
  const [side,      setSide]      = useState(null);
  const [note,      setNote]      = useState("");
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, startTime]);

  function startTimer() { const now = Date.now(); setStartTime(now); setRunning(true); setMode("timer"); }
  function stopTimer()  { setRunning(false); }

  function handleSave() {
    let start, duration;
    if (mode === "timer") {
      start    = startTime;
      duration = elapsed;
    } else if (mode === "past" && pastStart) {
      start    = new Date(pastStart).getTime();
      duration = pastEnd ? Math.floor((new Date(pastEnd).getTime() - start) / 1000) : null;
    } else {
      start    = Date.now();
      duration = null;
    }
    onSave({ startTime: start, duration, side, note });
  }

  const isFeed = ev.type === "feed";

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: t.bg2, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 420 }}>

        <div style={{ fontSize: 17, fontWeight: "700", marginBottom: 20, color: t.text, display: "flex", alignItems: "center", gap: 10 }}>
          <i className={ev.icon} style={{ color: ev.streak }} />
          Log {ev.label}
        </div>

        {/* Mode selector */}
        {mode !== "timer" && (
          <>
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>How to log</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {[{ v: "now", l: "Quick log" }, { v: "timer", l: "Use timer" }, { v: "past", l: "In the past" }].map(m => (
                <button key={m.v} onClick={() => m.v === "timer" ? startTimer() : setMode(m.v)}
                  style={{ flex: 1, padding: "10px 4px", borderRadius: 12, border: `2px solid ${mode === m.v ? ev.streak : t.border}`, background: mode === m.v ? `${ev.streak}18` : t.bg3, color: mode === m.v ? ev.streak : t.textMuted, fontWeight: "600", fontSize: 12, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                  {m.l}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Live Timer */}
        {mode === "timer" && (
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 52, fontWeight: "700", color: ev.streak, fontVariantNumeric: "tabular-nums" }}>
              {formatLiveDuration(startTime)}
            </div>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 20 }}>
              {running ? "Timer running..." : `Stopped — ${formatDuration(elapsed)}`}
            </div>
            {running ? (
              <button onClick={stopTimer} style={{ background: ev.streak, border: "none", borderRadius: 16, padding: "14px 40px", color: "#fff", fontWeight: "700", fontSize: 16, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                <i className="fa-solid fa-stop" style={{ marginRight: 8 }} />Stop
              </button>
            ) : (
              <button onClick={startTimer} style={{ background: t.bg3, border: `2px solid ${ev.streak}`, borderRadius: 16, padding: "12px 30px", color: ev.streak, fontWeight: "700", fontSize: 14, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                <i className="fa-solid fa-rotate-right" style={{ marginRight: 8 }} />Restart
              </button>
            )}
          </div>
        )}

        {/* Past mode */}
        {mode === "past" && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Start time</div>
            <input type="datetime-local" value={pastStart} onChange={e => setPastStart(e.target.value)}
              style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 12 }} />
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>End time (optional)</div>
            <input type="datetime-local" value={pastEnd} onChange={e => setPastEnd(e.target.value)}
              style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box" }} />
          </div>
        )}

        {/* Feed side selector */}
        {isFeed && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Side (breastfeeding)</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["Left", "Right", "Both", "Bottle"].map(s => (
                <button key={s} onClick={() => setSide(s)}
                  style={{ flex: 1, padding: "10px 4px", borderRadius: 12, border: `2px solid ${side === s ? ev.streak : t.border}`, background: side === s ? `${ev.streak}18` : t.bg3, color: side === s ? ev.streak : t.textMuted, fontWeight: "600", fontSize: 12, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Note */}
        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Note (optional)</div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Any observations..."
          style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 20 }} />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 14, border: `1px solid ${t.border}`, background: t.bg3, color: t.textMuted, fontWeight: "600", fontSize: 15, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: ev.streak, color: "#1a1a2e", fontWeight: "700", fontSize: 15, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Stats Tab ────────────────────────────────────────────────────────
function StatsScreen({ log, t }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayLog = log.filter(e => e.startTime >= today.getTime());
  const counts   = {};
  const durations = {};
  EVENT_TYPES.forEach(e => { counts[e.type] = 0; durations[e.type] = 0; });
  todayLog.forEach(e => {
    if (counts[e.type] !== undefined) {
      counts[e.type]++;
      if (e.duration) durations[e.type] += e.duration;
    }
  });
  const last24h = log.filter(e => e.startTime >= Date.now() - 86400000);

  return (
    <div style={{ padding: "24px 16px 100px" }}>
      <div style={{ fontSize: 18, fontWeight: "700", marginBottom: 4 }}>Today's Summary</div>
      <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 20 }}>
        {today.toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
        {EVENT_TYPES.map(ev => (
          <div key={ev.type} style={{ background: t.card, borderRadius: 18, padding: "18px 16px", border: `1px solid ${t.border}`, borderLeft: `4px solid ${ev.streak}`, boxShadow: `0 2px 12px ${t.shadow}` }}>
            <i className={ev.icon} style={{ fontSize: 22, color: ev.streak, marginBottom: 10, display: "block" }} />
            <div style={{ fontSize: 28, fontWeight: "700", color: ev.streak }}>{counts[ev.type]}</div>
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>{ev.label}s today</div>
            {durations[ev.type] > 0 && (
              <div style={{ fontSize: 12, color: t.accent, marginTop: 4 }}>
                Total: {formatDuration(durations[ev.type])}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 15, fontWeight: "700", marginBottom: 12 }}>Last 24 Hours</div>
      {last24h.length === 0 ? (
        <div style={{ color: t.textMuted, fontSize: 14, textAlign: "center", padding: 20 }}>No events in the last 24 hours</div>
      ) : (
        <div style={{ background: t.card, borderRadius: 18, padding: "4px 16px", border: `1px solid ${t.border}` }}>
          {last24h.map((item, i) => {
            const ev = EVENT_TYPES.find(e => e.type === item.type);
            return (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: i < last24h.length - 1 ? `1px solid ${t.border}` : "none" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <i className={ev?.icon} style={{ fontSize: 16, color: ev?.streak, width: 20 }} />
                  <span style={{ fontSize: 14, fontWeight: "600" }}>
                    {item.label}
                    {item.diaperType && <span style={{ fontSize: 12, color: t.textMuted }}> · {item.diaperType}</span>}
                    {item.side       && <span style={{ fontSize: 12, color: t.textMuted }}> · {item.side}</span>}
                    {item.duration   && <span style={{ fontSize: 12, color: t.accent }}> · {formatDuration(item.duration)}</span>}
                  </span>
                </span>
                <span style={{ fontSize: 13, color: t.textMuted }}>{timeSince(item.startTime)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────
function SettingsScreen({ profile, onSave, darkMode, onToggleTheme, t }) {
  const [form, setForm] = useState({ nickname: "", dob: "", gender: "", feedingType: "", birthWeight: "", city: "", notes: "", ageFormat: "Weeks", ...profile });
  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  function handleSave() {
    const updated = { ...form, theme: darkMode ? "dark" : "light" };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    onSave(updated);
  }

  const agePreview    = getAge(form.dob, form.ageFormat);
  const previewAccent = getAccent(form.gender);
  const inputStyle    = { width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box" };
  const optBtn = (active, color) => ({ background: active ? `${color || t.accent}18` : t.bg3, border: `1px solid ${active ? (color || t.accent) : t.border}`, borderRadius: 20, padding: "8px 16px", color: active ? (color || t.accent) : t.textMuted, fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif", transition: "all 0.2s" });
  const fieldLabel = (iconClass, text) => (
    <label style={{ fontSize: 13, color: t.textMuted, fontWeight: "600", display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <i className={iconClass} style={{ width: 16, color: t.accent }} />{text}
    </label>
  );

  return (
    <div style={{ padding: "24px 16px 100px" }}>
      <div style={{ fontSize: 18, fontWeight: "700", marginBottom: 4 }}>Baby Profile</div>
      <div style={{ fontSize: 13, color: t.textSub, marginBottom: 20, fontWeight: "600" }}>Helps BabySense AI make smarter predictions</div>
      <div style={{ background: t.card, borderRadius: 20, padding: "20px 18px", border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 22 }}>

        <div>{fieldLabel("fa-solid fa-tag", "Baby Nickname")}<input style={inputStyle} placeholder="e.g. Arya, Lil One..." value={form.nickname} onChange={e => set("nickname", e.target.value)} /></div>

        <div>
          {fieldLabel("fa-solid fa-cake-candles", "Date of Birth")}
          <input style={inputStyle} type="date" value={form.dob} onChange={e => set("dob", e.target.value)} />
          {getAge(form.dob, "Weeks") && <span style={{ fontSize: 11, color: t.textMuted, marginTop: 6, display: "block" }}>{getAge(form.dob, "Weeks")}</span>}
        </div>

        <div>
          {fieldLabel("fa-solid fa-user", "Gender")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[{ l: "Girl", v: "Girl", c: "#FF6B9D" }, { l: "Boy", v: "Boy", c: "#6B8CFF" }, { l: "Prefer not to say", v: "Prefer not to say", c: "#C4956A" }]
              .map(g => <button key={g.v} onClick={() => set("gender", g.v)} style={optBtn(form.gender === g.v, g.c)}>{g.l}</button>)}
          </div>
          {form.gender && <span style={{ fontSize: 11, color: previewAccent, marginTop: 6, display: "block", fontWeight: "600" }}>Accent color updates to match</span>}
        </div>

        <div>
          {fieldLabel("fa-solid fa-bottle-droplet", "Feeding Type")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["Breastfed", "Formula", "Both"].map(f => <button key={f} onClick={() => set("feedingType", f)} style={optBtn(form.feedingType === f)}>{f}</button>)}
          </div>
        </div>

        <div>{fieldLabel("fa-solid fa-weight-scale", "Birth Weight (kg)")}<input style={inputStyle} placeholder="e.g. 3.2" value={form.birthWeight} onChange={e => set("birthWeight", e.target.value)} /></div>

        <div>
          {fieldLabel("fa-solid fa-location-dot", "City")}
          <input style={inputStyle} placeholder="e.g. Ahmedabad" value={form.city} onChange={e => set("city", e.target.value)} />
          <span style={{ fontSize: 11, color: t.textMuted, marginTop: 6, display: "block" }}>Used for weather-aware predictions</span>
        </div>

        <div>{fieldLabel("fa-solid fa-note-sticky", "Special Notes")}<textarea style={{ ...inputStyle, height: 80, resize: "none" }} placeholder="e.g. premature, colic, allergies..." value={form.notes} onChange={e => set("notes", e.target.value)} /></div>

        <div>
          {fieldLabel("fa-solid fa-calendar-days", "Age Display Format")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["Days", "Weeks", "Months", "Years"].map(f => <button key={f} onClick={() => set("ageFormat", f)} style={optBtn(form.ageFormat === f)}>{f}</button>)}
          </div>
          {agePreview && form.dob && <span style={{ fontSize: 11, color: t.textMuted, marginTop: 6, display: "block" }}>Preview: {agePreview}</span>}
        </div>

        <div>
          {fieldLabel("fa-solid fa-circle-half-stroke", "Theme")}
          <div style={{ display: "flex", gap: 8 }}>
            {[{ l: "Dark", v: true }, { l: "Light", v: false }].map(m => (
              <button key={m.l} onClick={() => onToggleTheme(m.v)} style={optBtn(darkMode === m.v)}>{m.l}</button>
            ))}
          </div>
        </div>

        <button onClick={handleSave} style={{ width: "100%", border: "none", borderRadius: 16, padding: "16px", background: `linear-gradient(135deg, ${previewAccent}, #a78bfa)`, color: "#fff", fontSize: 16, fontWeight: "700", cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
          Save Profile
        </button>
      </div>
    </div>
  );
}

// ─── Home Tab ─────────────────────────────────────────────────────────
function HomeScreen({ log, onTap, prediction, aiLoading, t, activeModal, setActiveModal }) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const lastOf = (type) => log.find(e => e.type === type);

  return (
    <div style={{ padding: "16px 16px 100px" }}>

      {/* AI Card */}
      <div style={{ background: t.card, borderRadius: 20, padding: "18px 20px", marginBottom: 20, borderLeft: `4px solid ${t.accent}`, boxShadow: `0 4px 20px ${t.shadow}`, border: `1px solid ${t.border}` }}>
        <div style={{ fontSize: 11, color: t.accent, marginBottom: 8, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5, display: "flex", alignItems: "center", gap: 6 }}>
          <i className={aiLoading ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-wand-magic-sparkles"} />
          {aiLoading ? "AI is thinking..." : "AI Prediction"}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.6, color: t.text, fontWeight: "600", opacity: aiLoading ? 0.4 : 1, transition: "opacity 0.3s" }}>
          {prediction}
        </div>
      </div>

      {/* Event Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {EVENT_TYPES.map(ev => {
          const last = lastOf(ev.type);
          return (
            <div key={ev.type} style={{ background: t.card, borderRadius: 18, border: `1px solid ${t.border}`, borderLeft: `5px solid ${ev.streak}`, boxShadow: `0 2px 10px ${t.shadow}`, display: "flex", alignItems: "center", padding: "16px 14px", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: `${ev.streak}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <i className={ev.icon} style={{ fontSize: 20, color: ev.streak }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: "700", color: t.text }}>{ev.label}</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
                  {last ? (
                    <>
                      {timeSince(last.startTime)}
                      {last.duration   && <span style={{ color: t.accent }}> · {formatDuration(last.duration)}</span>}
                      {last.diaperType && <span style={{ color: t.accent }}> · {last.diaperType}</span>}
                      {last.side       && <span style={{ color: t.accent }}> · {last.side}</span>}
                    </>
                  ) : "Not logged yet"}
                </div>
              </div>
              <button onClick={() => setActiveModal(ev.type)} style={{ background: ev.streak, border: "none", borderRadius: 12, width: 40, height: 40, fontSize: 18, fontWeight: "700", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#1a1a2e", flexShrink: 0, boxShadow: `0 4px 12px ${ev.streak}66` }}>
                <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────
function TabBar({ tab, setTab, t }) {
  const tabs = [
    { id: "home",     icon: "fa-solid fa-house",        label: "Home"     },
    { id: "stats",    icon: "fa-solid fa-chart-simple",  label: "Stats"    },
    { id: "settings", icon: "fa-solid fa-gear",          label: "Settings" },
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 420, background: t.tabBg, borderTop: `1px solid ${t.tabBorder}`, display: "flex", zIndex: 100 }}>
      {tabs.map(tb => (
        <button key={tb.id} onClick={() => setTab(tb.id)} style={{ flex: 1, border: "none", background: "none", padding: "12px 0 16px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontFamily: "'Poppins', sans-serif" }}>
          <i className={tb.icon} style={{ fontSize: 20, color: tab === tb.id ? t.accent : t.textMuted }} />
          <span style={{ fontSize: 11, fontWeight: "600", color: tab === tb.id ? t.accent : t.textMuted }}>{tb.label}</span>
          {tab === tb.id && <div style={{ width: 20, height: 3, borderRadius: 2, background: t.accent }} />}
        </button>
      ))}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────
export default function App() {
  const [log, setLog]               = useState(() => loadLog());
  const [profile, setProfile]       = useState(() => loadProfile());
  const [tab, setTab]               = useState("home");
  const [activeModal, setActiveModal] = useState(null);
  const [prediction, setPrediction] = useState("Log a few events and I'll start predicting patterns.");
  const [aiLoading, setAiLoading]   = useState(false);
  const [darkMode, setDarkMode]     = useState(() => { const p = loadProfile(); return p.theme === "light" ? false : p.theme === "dark" ? true : isNightTime(); });
  const aiTimer = useRef(null);
  const t = getTheme(darkMode, profile.gender);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)); }, [log]);

  useEffect(() => {
    const interval = setInterval(() => { const p = loadProfile(); if (!p.theme) setDarkMode(isNightTime()); }, 60000);
    return () => clearInterval(interval);
  }, []);

  const refreshPrediction = useCallback(async (currentLog) => {
    setAiLoading(true);
    setPrediction(await getAIPrediction(currentLog, profile));
    setAiLoading(false);
  }, [profile]);

  function handleSave(eventType, data) {
    const ev    = EVENT_TYPES.find(e => e.type === eventType);
    const entry = { ...data, type: eventType, label: ev.label, icon: ev.icon, streak: ev.streak, id: Date.now() };
    const newLog = [entry, ...log.slice(0, 49)];
    setLog(newLog);
    setActiveModal(null);
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => refreshPrediction(newLog), 2000);
  }

  function handleToggleTheme(isDark) {
    setDarkMode(isDark);
    setProfile(prev => { const u = { ...prev, theme: isDark ? "dark" : "light" }; localStorage.setItem(PROFILE_KEY, JSON.stringify(u)); return u; });
  }

  const ageText    = getAge(profile.dob, profile.ageFormat || "Weeks");
  const activeEv   = EVENT_TYPES.find(e => e.type === activeModal);

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'Poppins', sans-serif", maxWidth: 420, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ padding: "20px 16px 12px", borderBottom: `1px solid ${t.border}`, background: t.bg, position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ fontSize: 20, fontWeight: "700", letterSpacing: "-0.3px" }}>BabySense AI</div>
        <div style={{ fontSize: 13, color: t.textSub, fontWeight: "600", marginTop: 2 }}>
          {profile.nickname ? `${profile.nickname}'s Tracker${ageText ? ` (${ageText})` : ""}` : "Your smart newborn assistant"}
        </div>
      </div>

      {/* Content */}
      {tab === "home"     && <HomeScreen log={log} onTap={() => {}} prediction={prediction} aiLoading={aiLoading} t={t} activeModal={activeModal} setActiveModal={setActiveModal} />}
      {tab === "stats"    && <StatsScreen log={log} t={t} />}
      {tab === "settings" && <SettingsScreen profile={profile} onSave={p => { setProfile(p); setDarkMode(p.theme === "light" ? false : p.theme === "dark" ? true : isNightTime()); }} darkMode={darkMode} onToggleTheme={handleToggleTheme} t={t} />}

      <TabBar tab={tab} setTab={setTab} t={t} />

      {/* Modals */}
      {activeModal && activeEv && (
        activeEv.hasDiaperType
          ? <DiaperModal t={t} onSave={d => handleSave(activeModal, d)} onClose={() => setActiveModal(null)} />
          : <TimerModal  ev={activeEv} t={t} onSave={d => handleSave(activeModal, d)} onClose={() => setActiveModal(null)} />
      )}
    </div>
  );
}
