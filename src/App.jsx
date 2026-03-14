import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────
const STORAGE_KEY    = "babysense_log";
const PROFILE_KEY    = "babysense_profile";
const CHAT_KEY       = "babysense_chat";
const API_KEY        = import.meta.env.VITE_GEMINI_KEY;
const APP_PASSPHRASE = "demo";
const SHEETS_URL     = "https://script.google.com/macros/s/AKfycbyJOeP33r2Z-2dlvFmh8kKeUgd_F57YM7UYUKcR7BLp4I3rBW6pcYSfHjxmuW7FKf3n/exec";

const EVENT_TYPES = [
  { type: "feed",      label: "Feed",       icon: "fa-solid fa-bottle-droplet", streak: "#FF6B6B" },
  { type: "sleep",     label: "Sleep",      icon: "fa-solid fa-moon",           streak: "#6B8CFF" },
  { type: "diaper",    label: "Diaper",     icon: "fa-solid fa-baby",           streak: "#FFD93D" },
  { type: "cry",       label: "Cry",        icon: "fa-solid fa-face-sad-tear",  streak: "#6BCB77" },
  { type: "tummytime", label: "Tummy Time", icon: "fa-solid fa-child-reaching", streak: "#FF9F43" },
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
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

// ✅ FIX 1: Removed SEED_DATA reference
function loadLog()     { try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); return (s && s.length > 0) ? s : []; } catch { return []; } }
function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch { return {}; } }
function loadChat()    { try { return JSON.parse(localStorage.getItem(CHAT_KEY))     || []; } catch { return []; } }

// ─── CSV ──────────────────────────────────────────────────────────────
// ✅ FIX: Removed "type" (same as label) and "id" (not required). Fixed header casing. Added Feeding Type + Nursing Side.
function exportCSV(log) {
  const headers = ["Date", "Time", "Label", "Duration", "Diaper Type", "Feeding Type", "Nursing Side", "Note"];
  const rows = log.map(e => {
    const d    = new Date(e.startTime);
    const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
    const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    const dur  = e.duration ? formatDuration(e.duration) : "";
    const vals = [date, time, e.label ?? "", dur, e.diaperType ?? "", e.feedingType ?? "", e.side ?? "", e.note ?? ""];
    return vals.map(v => typeof v === "string" && v.includes(",") ? `"${v}"` : v).join(",");
  });
  const csv  = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a"); a.href = url; a.download = "babysense_log.csv"; a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const lines   = text.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const obj  = {};
    headers.forEach((h, i) => {
      const v = vals[i]?.replace(/^"|"$/g, "") ?? "";
      obj[h]  = h === "startTime" || h === "duration" ? (Number(v) || null) : v || null;
    });
    return obj;
  });
}

// ─── Theme ────────────────────────────────────────────────────────────
function getAccent(gender) {
  if (gender === "Girl")              return "#FF6B9D";
  if (gender === "Prefer not to say") return "#C4956A";
  return "#6B8CFF";
}

function getTheme(dark, gender) {
  const accent = getAccent(gender);
  return dark ? {
    bg: "#0d0d14", bg2: "#16161f", bg3: "#1e1e2e",
    card: "#16161f", border: "#22223a", text: "#f0f0f8",
    textSub: accent, textMuted: "#666", textFaint: "#333",
    accent, shadow: `${accent}33`, tabBg: "#0d0d14", tabBorder: "#1e1e2e",
    userBubble: accent, aiBubble: "#1e1e2e",
  } : {
    bg: "#f7f7fc", bg2: "#ffffff", bg3: "#eeeef8",
    card: "#ffffff", border: "#e8e8f4", text: "#1a1a2e",
    textSub: accent, textMuted: "#999", textFaint: "#ccc",
    accent, shadow: `${accent}22`, tabBg: "#ffffff", tabBorder: "#e8e8f4",
    userBubble: accent, aiBubble: "#eeeef8",
  };
}

// ─── Auth Screen ──────────────────────────────────────────────────────
// ✅ FIX 3: Added show/hide password toggle
function AuthScreen({ t, onUnlock }) {
  const [input,    setInput]    = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState(false);
  const [shake,    setShake]    = useState(false);

  function handleSubmit() {
    if (input === APP_PASSPHRASE) {
      sessionStorage.setItem("bs_auth", "1");
      onUnlock();
    } else {
      setError(true); setShake(true); setInput("");
      setTimeout(() => setShake(false), 500);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{
        background: t.card, borderRadius: 28, padding: "40px 28px", width: "100%", maxWidth: 360,
        boxShadow: `0 8px 40px ${t.shadow}`, border: `1px solid ${t.border}`,
        animation: shake ? "shake 0.4s ease" : "none",
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>🍼</div>
          <div style={{ fontSize: 22, fontWeight: "800", color: t.text, fontFamily: "'Poppins', sans-serif" }}>BabySense</div>
          <div style={{ fontSize: 13, color: t.textMuted, marginTop: 6 }}><p>Enter your passphrase to continue. Use <em>demo</em> to try.</p></div>
        </div>
        <div style={{ position: "relative", marginBottom: 8 }}>
          <input
            type={showPass ? "text" : "password"}
            value={input}
            onChange={e => { setInput(e.target.value); setError(false); }}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder="Passphrase"
            autoFocus
            style={{
              width: "100%", padding: "14px 48px 14px 16px", borderRadius: 14, fontSize: 15,
              border: `2px solid ${error ? "#FF6B6B" : t.border}`,
              background: t.bg3, color: t.text, fontFamily: "'Poppins', sans-serif",
              boxSizing: "border-box", outline: "none", transition: "border 0.2s",
            }}
          />
          <button
            onClick={() => setShowPass(p => !p)}
            style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: t.textMuted, fontSize: 15, padding: 0 }}
          >
            <i className={showPass ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
          </button>
        </div>
        {error && (
          <div style={{ color: "#FF6B6B", fontSize: 12, fontWeight: "600", marginBottom: 12, textAlign: "center" }}>
            <i className="fa-solid fa-circle-exclamation" style={{ marginRight: 6 }} />Incorrect passphrase. Try again.
          </div>
        )}
        <button
          onClick={handleSubmit}
          style={{
            width: "100%", padding: "14px", borderRadius: 14, border: "none",
            background: t.accent, color: "#fff", fontWeight: "700", fontSize: 15,
            cursor: "pointer", fontFamily: "'Poppins', sans-serif", marginTop: error ? 0 : 8,
            boxShadow: `0 4px 16px ${t.shadow}`,
          }}
        >
          Unlock <i className="fa-solid fa-unlock" style={{ marginLeft: 8 }} />
        </button>
      </div>
      <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-6px)} 80%{transform:translateX(6px)} }`}</style>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────
function Toast({ message, visible }) {
  return (
    <div style={{
      position: "fixed", bottom: 90, left: "50%", transform: `translateX(-50%) translateY(${visible ? 0 : 20}px)`,
      background: "#1a1a2e", color: "#fff", padding: "12px 24px", borderRadius: 30,
      fontSize: 14, fontWeight: "600", opacity: visible ? 1 : 0,
      transition: "all 0.3s ease", zIndex: 300, whiteSpace: "nowrap",
      boxShadow: "0 4px 20px #00000044",
    }}>
      <i className="fa-solid fa-circle-check" style={{ marginRight: 8, color: "#6BCB77" }} />
      {message}
    </div>
  );
}

// ─── Google Sheets Sync ───────────────────────────────────────────────
async function syncToSheets(log, profile) {
  if (!SHEETS_URL) return;
  try {
    await fetch(SHEETS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "sync", entries: log, profile }),
    });
  } catch (err) {
    console.warn("Sheets sync failed:", err);
  }
}

// ─── AI Calls ─────────────────────────────────────────────────────────
function buildProfileContext(profile) {
  if (!profile.nickname) return "";
  const age = getAge(profile.dob, "Weeks");
  return `Baby: ${profile.nickname}, ${age || "age unknown"}, ${profile.gender || "unknown gender"}, ${profile.feedingType || "unknown feeding"} fed, location: ${profile.city || "unknown"}. Notes: ${profile.notes || "none"}.`;
}

function buildLogSummary(log) {
  return log.slice(0, 20).map(e => {
    const mins  = Math.floor((Date.now() - e.startTime) / 60000);
    const dur   = e.duration   ? ` for ${formatDuration(e.duration)}`   : "";
    const extra = e.diaperType ? ` (${e.diaperType})` : e.side ? ` (${e.side})` : "";
    return `${e.label}${extra}${dur} — ${mins}min ago`;
  }).join("; ");
}

async function getAIPrediction(log, profile) {
  if (!API_KEY)       return "API key not set — check Vercel environment variables.";
  if (log.length < 2) return "Log a few more events and I'll start predicting patterns.";
  const prompt = `You are a warm expert baby care assistant. ${buildProfileContext(profile)}
Recent events: ${buildLogSummary(log)}.
Predict: 1) What baby likely needs next and when. 2) If crying was recent, most likely reason. Be specific, warm, max 3 sentences. No intro phrases.`;
  try {
    const res  = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 150, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Analyzing patterns...";
  } catch { return "Couldn't reach AI — check connection."; }
}

async function askAI(userMessage, chatHistory, log, profile) {
  if (!API_KEY) return { reply: "API key not set.", parsed: null };

  const historyText = chatHistory.slice(-10)
    .map(m => `${m.role === "user" ? "Parent" : "Assistant"}: ${m.text}`)
    .join("\n");
  const logSummary = buildLogSummary(log);
  const profileCtx = buildProfileContext(profile);

  const prompt = `You are BabySense AI, a warm expert baby care assistant.
${profileCtx}
Recent baby events: ${logSummary}.
Previous conversation:
${historyText}

Parent says: "${userMessage}"

Instructions:
- Answer the parent's question warmly and helpfully using the event data above.
- If the message describes a new loggable event (feeding, sleep, diaper, crying, tummy time), add this EXACT line at the very end of your response (after your reply):
LOGENTRY:{"type":"feed|sleep|diaper|cry|tummytime","label":"Feed|Sleep|Diaper|Cry|Tummy Time","startTime":${Date.now()},"duration":null,"diaperType":null,"side":null,"note":""}
- Only add LOGENTRY if there is clearly a NEW event being reported. Do NOT add it for questions.
- Use null for unknown fields. Duration in seconds if mentioned.`;

  try {
    const res  = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    const data = await res.json();
    console.log("Gemini raw response:", JSON.stringify(data));
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!raw) return { reply: "I didn't get a response — please try again.", parsed: null };

    const splitIndex = raw.lastIndexOf("LOGENTRY:");
    if (splitIndex === -1) return { reply: raw.trim(), parsed: null };

    const reply    = raw.slice(0, splitIndex).trim();
    const jsonPart = raw.slice(splitIndex + 9).trim();
    let parsed     = null;
    try { parsed = JSON.parse(jsonPart); } catch { parsed = null; }

    return { reply: reply || raw.trim(), parsed };
  } catch (err) {
    console.error("AI error:", err);
    return { reply: "Couldn't reach AI — check your connection.", parsed: null };
  }
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
    <button onClick={() => setDiaperType(type)} style={{ flex: 1, padding: "14px 8px", borderRadius: 14, border: `2px solid ${diaperType === type ? color : t.border}`, background: diaperType === type ? `${color}18` : t.bg3, color: diaperType === type ? color : t.textMuted, fontWeight: "700", fontSize: 14, cursor: "pointer", fontFamily: "'Poppins', sans-serif", transition: "all 0.15s" }}>{label}</button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: t.bg2, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 420 }}>
        <div style={{ fontSize: 17, fontWeight: "700", marginBottom: 20, color: t.text }}>
          <i className="fa-solid fa-baby" style={{ marginRight: 10, color: "#FFD93D" }} />Log Diaper Change
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Type</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {typeBtn("Wet","Wet","#6B8CFF")}{typeBtn("Dirty","Dirty","#FF6B6B")}{typeBtn("Both","Both","#FFD93D")}
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>When</div>
        <div style={{ display: "flex", gap: 10, marginBottom: pastMode ? 12 : 20 }}>
          <button onClick={() => setPastMode(false)} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `2px solid ${!pastMode ? t.accent : t.border}`, background: !pastMode ? `${t.accent}18` : t.bg3, color: !pastMode ? t.accent : t.textMuted, fontWeight: "600", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Now</button>
          <button onClick={() => setPastMode(true)}  style={{ flex: 1, padding: "10px", borderRadius: 12, border: `2px solid ${ pastMode ? t.accent : t.border}`, background:  pastMode ? `${t.accent}18` : t.bg3, color:  pastMode ? t.accent : t.textMuted, fontWeight: "600", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>In the past</button>
        </div>
        {pastMode && <input type="datetime-local" value={pastTime} onChange={e => setPastTime(e.target.value)} style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 16 }} />}
        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Note (optional)</div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Any observations..." style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 20 }} />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}    style={{ flex: 1, padding: "14px", borderRadius: 14, border: `1px solid ${t.border}`, background: t.bg3, color: t.textMuted, fontWeight: "600", fontSize: 15, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Cancel</button>
          <button onClick={handleSave} disabled={!diaperType} style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: diaperType ? "#FFD93D" : t.bg3, color: diaperType ? "#1a1a2e" : t.textMuted, fontWeight: "700", fontSize: 15, cursor: diaperType ? "pointer" : "default", fontFamily: "'Poppins', sans-serif" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Timer Modal ──────────────────────────────────────────────────────
// ✅ FIX 5: Added Feeding Type (Nursing/Formula) per feed
// ✅ FIX 6: Renamed "Side" → "Nursing Side", shown only for Nursing
function TimerModal({ ev, t, onSave, onClose }) {
  const [mode,      setMode]      = useState("now");
  const [running,   setRunning]   = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [elapsed,   setElapsed]   = useState(0);
  const [pastStart, setPastStart] = useState("");
  const [pastEnd,   setPastEnd]   = useState("");
  const [feedType,  setFeedType]  = useState(null);
  const [side,      setSide]      = useState(null);
  const [note,      setNote]      = useState("");
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) { intervalRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000); }
    else clearInterval(intervalRef.current);
    return () => clearInterval(intervalRef.current);
  }, [running, startTime]);

  function startTimer() { const now = Date.now(); setStartTime(now); setRunning(true); setMode("timer"); }
  function stopTimer()  { setRunning(false); }

  function handleSave() {
    let start, duration;
    if (mode === "timer")                 { start = startTime; duration = elapsed; }
    else if (mode === "past" && pastStart) { start = new Date(pastStart).getTime(); duration = pastEnd ? Math.floor((new Date(pastEnd).getTime() - start) / 1000) : null; }
    else                                  { start = Date.now(); duration = null; }
    onSave({ startTime: start, duration, feedingType: feedType, side, note });
  }

  const isFeed = ev.type === "feed";
  const modeBtn = (v, l) => (
    <button onClick={() => v === "timer" ? startTimer() : setMode(v)} style={{ flex: 1, padding: "10px 4px", borderRadius: 12, border: `2px solid ${mode === v ? ev.streak : t.border}`, background: mode === v ? `${ev.streak}18` : t.bg3, color: mode === v ? ev.streak : t.textMuted, fontWeight: "600", fontSize: 12, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>{l}</button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: t.bg2, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ fontSize: 17, fontWeight: "700", marginBottom: 20, color: t.text, display: "flex", alignItems: "center", gap: 10 }}>
          <i className={ev.icon} style={{ color: ev.streak }} />Log {ev.label}
        </div>
        {mode !== "timer" && (
          <>
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>How to log</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>{modeBtn("now","Quick log")}{modeBtn("timer","Use timer")}{modeBtn("past","In the past")}</div>
          </>
        )}
        {mode === "timer" && (
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 52, fontWeight: "700", color: ev.streak, fontVariantNumeric: "tabular-nums" }}>{formatLiveDuration(startTime)}</div>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 20 }}>{running ? "Timer running..." : `Stopped — ${formatDuration(elapsed)}`}</div>
            {running
              ? <button onClick={stopTimer}  style={{ background: ev.streak, border: "none", borderRadius: 16, padding: "14px 40px", color: "#fff", fontWeight: "700", fontSize: 16, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}><i className="fa-solid fa-stop" style={{ marginRight: 8 }} />Stop</button>
              : <button onClick={startTimer} style={{ background: t.bg3, border: `2px solid ${ev.streak}`, borderRadius: 16, padding: "12px 30px", color: ev.streak, fontWeight: "700", fontSize: 14, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}><i className="fa-solid fa-rotate-right" style={{ marginRight: 8 }} />Restart</button>
            }
          </div>
        )}
        {mode === "past" && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Start time</div>
            <input type="datetime-local" value={pastStart} onChange={e => setPastStart(e.target.value)} style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 12 }} />
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>End time (optional)</div>
            <input type="datetime-local" value={pastEnd} onChange={e => setPastEnd(e.target.value)} style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box" }} />
          </div>
        )}
        {isFeed && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Feeding Type</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {["Nursing", "Formula"].map(f => (
                <button key={f} onClick={() => { setFeedType(f); if (f === "Formula") setSide(null); }}
                  style={{ flex: 1, padding: "10px 4px", borderRadius: 12, border: `2px solid ${feedType === f ? ev.streak : t.border}`, background: feedType === f ? `${ev.streak}18` : t.bg3, color: feedType === f ? ev.streak : t.textMuted, fontWeight: "600", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                  {f}
                </button>
              ))}
            </div>
            {feedType === "Nursing" && (
              <>
                <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Nursing Side</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["Left", "Right", "Both"].map(s => (
                    <button key={s} onClick={() => setSide(s)}
                      style={{ flex: 1, padding: "10px 4px", borderRadius: 12, border: `2px solid ${side === s ? ev.streak : t.border}`, background: side === s ? `${ev.streak}18` : t.bg3, color: side === s ? ev.streak : t.textMuted, fontWeight: "600", fontSize: 12, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Note (optional)</div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Any observations..." style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 20 }} />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}    style={{ flex: 1, padding: "14px", borderRadius: 14, border: `1px solid ${t.border}`, background: t.bg3, color: t.textMuted, fontWeight: "600", fontSize: 15, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: ev.streak, color: "#1a1a2e", fontWeight: "700", fontSize: 15, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Entry Preview Card ───────────────────────────────────────────────
function EntryPreview({ entry, t, onConfirm, onDiscard }) {
  const ev = EVENT_TYPES.find(e => e.type === entry.type);
  return (
    <div style={{ background: t.bg3, borderRadius: 16, padding: "14px 16px", margin: "10px 0", border: `2px solid ${ev?.streak || t.accent}` }}>
      <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
        <i className="fa-solid fa-wand-magic-sparkles" style={{ marginRight: 6, color: t.accent }} />
        AI detected an entry
      </div>
      <div style={{ fontSize: 14, fontWeight: "600", color: t.text, marginBottom: 4 }}>
        <i className={ev?.icon} style={{ marginRight: 8, color: ev?.streak }} />
        {entry.label}
        {entry.side       && <span style={{ color: t.textMuted }}> · {entry.side}</span>}
        {entry.diaperType && <span style={{ color: t.textMuted }}> · {entry.diaperType}</span>}
        {entry.duration   && <span style={{ color: t.accent }}> · {formatDuration(entry.duration)}</span>}
        {entry.note       && <span style={{ color: t.textMuted }}> · {entry.note}</span>}
      </div>
      <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>
        At {new Date(entry.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDiscard} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${t.border}`, background: t.bg2, color: t.textMuted, fontWeight: "600", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
          <i className="fa-solid fa-xmark" style={{ marginRight: 6 }} />Discard
        </button>
        <button onClick={onConfirm} style={{ flex: 2, padding: "10px", borderRadius: 12, border: "none", background: ev?.streak || t.accent, color: "#1a1a2e", fontWeight: "700", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
          <i className="fa-solid fa-check" style={{ marginRight: 6 }} />Save Entry
        </button>
      </div>
    </div>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────
function HomeScreen({ log, prediction, aiLoading, t, setActiveModal, onSaveEntry, profile }) {
  const [aiTab,        setAiTab]        = useState("prediction");
  const [chatHistory,  setChatHistory]  = useState(() => loadChat());
  const [inputText,    setInputText]    = useState("");
  const [chatLoading,  setChatLoading]  = useState(false);
  const [pendingEntry, setPendingEntry] = useState(null);
  const [listening,    setListening]    = useState(false);
  const chatEndRef     = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatHistory));
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  function startVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Voice input not supported on this browser. Try Chrome."); return; }
    const r = new SpeechRecognition();
    r.lang = "en-IN"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = e => { setInputText(e.results[0][0].transcript); setListening(false); };
    r.onerror  = ()  => setListening(false);
    r.onend    = ()  => setListening(false);
    recognitionRef.current = r;
    r.start(); setListening(true);
  }

  async function handleSend() {
    const text = inputText.trim();
    if (!text || chatLoading) return;
    const userMsg    = { role: "user", text, time: Date.now() };
    const newHistory = [...chatHistory, userMsg];
    setChatHistory(newHistory);
    setInputText("");
    setChatLoading(true);
    const { reply, parsed } = await askAI(text, newHistory, log, profile);
    const aiMsg = { role: "ai", text: reply, time: Date.now() };
    setChatHistory(h => [...h, aiMsg]);
    if (parsed) setPendingEntry(parsed);
    setChatLoading(false);
  }

  function confirmEntry() {
    if (pendingEntry) { onSaveEntry(pendingEntry.type, pendingEntry); setPendingEntry(null); }
  }

  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const lastOf = (type) => log.find(e => e.type === type);

  return (
    <div style={{ padding: "16px 16px 100px" }}>
      {/* AI Panel */}
      <div style={{ background: t.card, borderRadius: 20, border: `1px solid ${t.border}`, marginBottom: 20, overflow: "hidden", boxShadow: `0 4px 20px ${t.shadow}` }}>
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${t.border}` }}>
          {[{ id: "prediction", icon: "fa-solid fa-wand-magic-sparkles", label: "Prediction" }, { id: "askai", icon: "fa-solid fa-comments", label: "Ask AI" }].map(tab => (
            <button key={tab.id} onClick={() => setAiTab(tab.id)} style={{ flex: 1, padding: "12px 8px", border: "none", background: aiTab === tab.id ? `${t.accent}18` : "transparent", color: aiTab === tab.id ? t.accent : t.textMuted, fontWeight: "700", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif", borderBottom: aiTab === tab.id ? `2px solid ${t.accent}` : "2px solid transparent", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <i className={tab.icon} style={{ fontSize: 13 }} />{tab.label}
            </button>
          ))}
        </div>
        {/* Prediction Tab */}
        {aiTab === "prediction" && (
          <div style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 11, color: t.accent, marginBottom: 8, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5, display: "flex", alignItems: "center", gap: 6 }}>
              <i className={aiLoading ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-wand-magic-sparkles"} />
              {aiLoading ? "Thinking..." : "What to expect next"}
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.7, color: t.text, opacity: aiLoading ? 0.4 : 1, transition: "opacity 0.3s" }}>{prediction}</div>
          </div>
        )}
        {/* Ask AI Tab */}
        {aiTab === "askai" && (
          <div style={{ display: "flex", flexDirection: "column", height: 320 }}>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {chatHistory.length === 0 && (
                <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, marginTop: 20 }}>
                  <i className="fa-solid fa-comments" style={{ fontSize: 28, marginBottom: 10, display: "block", color: t.accent }} />
                  Ask me anything about {profile.nickname || "your baby"}, or tell me what happened and I'll log it for you.
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "80%", padding: "10px 14px", borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: msg.role === "user" ? t.accent : t.aiBubble, color: msg.role === "user" ? "#fff" : t.text, fontSize: 14, lineHeight: 1.5 }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{ padding: "10px 16px", borderRadius: "18px 18px 18px 4px", background: t.aiBubble, color: t.textMuted, fontSize: 14 }}>
                    <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 6 }} />Thinking...
                  </div>
                </div>
              )}
              {pendingEntry && (
                <EntryPreview entry={pendingEntry} t={t} onConfirm={confirmEntry} onDiscard={() => setPendingEntry(null)} />
              )}
              <div ref={chatEndRef} />
            </div>
            {/* Input */}
            <div style={{ padding: "10px 12px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={startVoice} style={{ background: listening ? t.accent : t.bg3, border: `1px solid ${listening ? t.accent : t.border}`, borderRadius: 10, width: 38, height: 38, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}>
                <i className={`fa-solid fa-microphone${listening ? " fa-beat" : ""}`} style={{ fontSize: 15, color: listening ? "#fff" : t.textMuted }} />
              </button>
              <input
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder="Ask anything or describe what happened..."
                style={{ flex: 1, background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px", color: t.text, fontSize: 13, fontFamily: "'Poppins', sans-serif", outline: "none" }}
              />
              <button onClick={handleSend} disabled={!inputText.trim() || chatLoading} style={{ background: inputText.trim() ? t.accent : t.bg3, border: "none", borderRadius: 10, width: 38, height: 38, cursor: inputText.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}>
                <i className="fa-solid fa-paper-plane" style={{ fontSize: 14, color: inputText.trim() ? "#fff" : t.textMuted }} />
              </button>
            </div>
          </div>
        )}
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
                    <>{timeSince(last.startTime)}{last.duration && <span style={{ color: t.accent }}> · {formatDuration(last.duration)}</span>}{last.diaperType && <span style={{ color: t.accent }}> · {last.diaperType}</span>}{last.side && <span style={{ color: t.accent }}> · {last.side}</span>}</>
                  ) : "Not logged yet"}
                </div>
              </div>
              <button onClick={() => setActiveModal(ev.type)} style={{ background: ev.streak, border: "none", borderRadius: 12, width: 40, height: 40, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#1a1a2e", flexShrink: 0, boxShadow: `0 4px 12px ${ev.streak}66` }}>
                <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Edit Entry Modal ─────────────────────────────────────────────────
// ✅ FIX 6: "Side" → "Nursing Side" in edit modal
function EditEntryModal({ entry, t, onSave, onDelete, onClose }) {
  const ev = EVENT_TYPES.find(e => e.type === entry.type);
  const toLocalDT = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [startVal,    setStartVal]    = useState(toLocalDT(entry.startTime));
  const [durationVal, setDurationVal] = useState(entry.duration ? String(Math.floor(entry.duration / 60)) : "");
  const [feedingType, setFeedingType] = useState(entry.feedingType || null);
  const [diaperType,  setDiaperType]  = useState(entry.diaperType || null);
  const [side,        setSide]        = useState(entry.side || null);
  const [note,        setNote]        = useState(entry.note || "");

  function handleSave() {
    const updated = {
      ...entry,
      startTime:   startVal ? new Date(startVal).getTime() : entry.startTime,
      duration:    durationVal ? parseInt(durationVal) * 60 : null,
      feedingType: feedingType,
      diaperType:  diaperType,
      side:        side,
      note:        note,
    };
    onSave(updated);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: t.bg2, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ fontSize: 17, fontWeight: "700", marginBottom: 20, color: t.text, display: "flex", alignItems: "center", gap: 10 }}>
          <i className={ev?.icon} style={{ color: ev?.streak }} />Edit {entry.label}
        </div>

        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Date & Time</div>
        <input type="datetime-local" value={startVal} onChange={e => setStartVal(e.target.value)}
          style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 16 }} />

        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Duration (minutes)</div>
        <input type="number" value={durationVal} onChange={e => setDurationVal(e.target.value)} placeholder="e.g. 15"
          style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 16 }} />

        {entry.type === "diaper" && (
          <>
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Diaper Type</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["Wet", "Dirty", "Both"].map(tp => (
                <button key={tp} onClick={() => setDiaperType(tp)}
                  style={{ flex: 1, padding: "10px", borderRadius: 12, border: `2px solid ${diaperType === tp ? ev?.streak : t.border}`, background: diaperType === tp ? `${ev?.streak}18` : t.bg3, color: diaperType === tp ? ev?.streak : t.textMuted, fontWeight: "600", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                  {tp}
                </button>
              ))}
            </div>
          </>
        )}

        {entry.type === "feed" && (
          <>
            <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Feeding Type</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {["Nursing", "Formula"].map(f => (
                <button key={f} onClick={() => { setFeedingType(f); if (f === "Formula") setSide(null); }}
                  style={{ flex: 1, padding: "10px 4px", borderRadius: 12, border: `2px solid ${feedingType === f ? ev?.streak : t.border}`, background: feedingType === f ? `${ev?.streak}18` : t.bg3, color: feedingType === f ? ev?.streak : t.textMuted, fontWeight: "600", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                  {f}
                </button>
              ))}
            </div>
            {feedingType === "Nursing" && (
              <>
                <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Nursing Side</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {["Left", "Right", "Both"].map(s => (
                    <button key={s} onClick={() => setSide(s)}
                      style={{ flex: 1, padding: "10px 4px", borderRadius: 12, border: `2px solid ${side === s ? ev?.streak : t.border}`, background: side === s ? `${ev?.streak}18` : t.bg3, color: side === s ? ev?.streak : t.textMuted, fontWeight: "600", fontSize: 12, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div style={{ fontSize: 12, color: t.textMuted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Note</div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Any observations..."
          style={{ width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", marginBottom: 20 }} />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => onDelete(entry.id)} style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1px solid #FF6B6B", background: "#FF6B6B18", color: "#FF6B6B", fontWeight: "700", fontSize: 14, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
            <i className="fa-solid fa-trash" style={{ marginRight: 6 }} />Delete
          </button>
          <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 14, border: `1px solid ${t.border}`, background: t.bg3, color: t.textMuted, fontWeight: "600", fontSize: 14, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: ev?.streak || t.accent, color: "#1a1a2e", fontWeight: "700", fontSize: 14, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Stats Screen ─────────────────────────────────────────────────────
function StatsScreen({ log, setLog, t, showToast }) {
  const [filter,     setFilter]     = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");
  const [editEntry,  setEditEntry]  = useState(null);
  const fileInputRef = useRef(null);

  const now   = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const filtered = log.filter(e => {
    if (filter === "today")  return e.startTime >= today.getTime();
    if (filter === "7days")  return e.startTime >= now - 7  * 86400000;
    if (filter === "30days") return e.startTime >= now - 30 * 86400000;
    if (filter === "custom") {
      const from = customFrom ? new Date(customFrom).getTime() : 0;
      const to   = customTo   ? new Date(customTo).getTime() + 86399999 : now;
      return e.startTime >= from && e.startTime <= to;
    }
    return true;
  });

  const counts = {}, durations = {};
  EVENT_TYPES.forEach(e => { counts[e.type] = 0; durations[e.type] = 0; });
  filtered.forEach(e => { if (counts[e.type] !== undefined) { counts[e.type]++; if (e.duration) durations[e.type] += e.duration; } });

  function handleUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseCSV(ev.target.result);
      const action = window.confirm("Merge with existing data?\nOK = Merge   Cancel = Replace");
      const newLog = action ? [...log, ...parsed].sort((a, b) => b.startTime - a.startTime) : parsed;
      setLog(newLog);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLog));
      showToast("Data imported successfully!");
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleSaveEdit(updated) {
    const newLog = log.map(e => e.id === updated.id ? updated : e);
    setLog(newLog);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLog));
    setEditEntry(null);
    showToast("Entry updated!");
  }

  function handleDeleteEntry(id) {
    if (!window.confirm("Delete this entry?")) return;
    const newLog = log.filter(e => e.id !== id);
    setLog(newLog);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLog));
    setEditEntry(null);
    showToast("Entry deleted!");
  }

  const filterBtn = (v, l) => (
    <button key={v} onClick={() => setFilter(v)} style={{ padding: "8px 14px", borderRadius: 20, border: `1px solid ${filter === v ? t.accent : t.border}`, background: filter === v ? `${t.accent}18` : t.bg3, color: filter === v ? t.accent : t.textMuted, fontWeight: "600", fontSize: 12, cursor: "pointer", fontFamily: "'Poppins', sans-serif", whiteSpace: "nowrap" }}>{l}</button>
  );

  return (
    <div style={{ padding: "24px 16px 100px" }}>
      <div style={{ fontSize: 18, fontWeight: "700", marginBottom: 16 }}>Stats</div>

      {/* Filter Bar */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16, paddingBottom: 4 }}>
        {filterBtn("today","Today")}{filterBtn("7days","7 Days")}{filterBtn("30days","30 Days")}{filterBtn("all","All Time")}{filterBtn("custom","Custom")}
      </div>

      {filter === "custom" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            style={{ flex: 1, background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "10px 12px", color: t.text, fontSize: 13, fontFamily: "'Poppins', sans-serif" }} />
          <span style={{ color: t.textMuted, fontSize: 13 }}>to</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            style={{ flex: 1, background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "10px 12px", color: t.text, fontSize: 13, fontFamily: "'Poppins', sans-serif" }} />
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        {EVENT_TYPES.map(ev => (
          <div key={ev.type} style={{ background: t.card, borderRadius: 18, padding: "18px 16px", border: `1px solid ${t.border}`, borderLeft: `4px solid ${ev.streak}`, boxShadow: `0 2px 12px ${t.shadow}` }}>
            <i className={ev.icon} style={{ fontSize: 20, color: ev.streak, marginBottom: 10, display: "block" }} />
            <div style={{ fontSize: 28, fontWeight: "700", color: ev.streak }}>{counts[ev.type]}</div>
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>{ev.label}s</div>
            {durations[ev.type] > 0 && <div style={{ fontSize: 12, color: t.accent, marginTop: 4 }}>Total: {formatDuration(durations[ev.type])}</div>}
          </div>
        ))}
      </div>

      {/* CSV Buttons */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <button onClick={() => exportCSV(filtered)} style={{ flex: 1, padding: "12px", borderRadius: 14, border: `1px solid ${t.accent}`, background: `${t.accent}18`, color: t.accent, fontWeight: "700", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <i className="fa-solid fa-download" style={{ marginRight: 6 }} />Export CSV
        </button>
        <button onClick={() => fileInputRef.current.click()} style={{ flex: 1, padding: "12px", borderRadius: 14, border: `1px solid ${t.border}`, background: t.bg3, color: t.textMuted, fontWeight: "700", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
          <i className="fa-solid fa-upload" style={{ marginRight: 6 }} />Import CSV
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleUpload} />
      </div>

      {/* Event List */}
      <div style={{ fontSize: 15, fontWeight: "700", marginBottom: 12 }}>Event Log</div>
      {filtered.length === 0 ? (
        <div style={{ color: t.textMuted, fontSize: 14, textAlign: "center", padding: 20 }}>No events in this period</div>
      ) : (
        <div style={{ background: t.card, borderRadius: 18, padding: "4px 16px", border: `1px solid ${t.border}` }}>
          {filtered.map((item, i) => {
            const ev = EVENT_TYPES.find(e => e.type === item.type);
            return (
              <div key={item.id || i} onClick={() => setEditEntry(item)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: i < filtered.length - 1 ? `1px solid ${t.border}` : "none", cursor: "pointer" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <i className={ev?.icon} style={{ fontSize: 16, color: ev?.streak, width: 20 }} />
                  <span style={{ fontSize: 14, fontWeight: "600", color: t.text }}>
                    {item.label}
                    {item.feedingType && <span style={{ fontSize: 12, color: t.textMuted }}> · {item.feedingType}</span>}
                    {item.diaperType  && <span style={{ fontSize: 12, color: t.textMuted }}> · {item.diaperType}</span>}
                    {item.side        && <span style={{ fontSize: 12, color: t.textMuted }}> · {item.side}</span>}
                    {item.duration    && <span style={{ fontSize: 12, color: t.accent }}> · {formatDuration(item.duration)}</span>}
                    {item.note        && <span style={{ fontSize: 12, color: t.textMuted }}> · {item.note}</span>}
                  </span>
                </span>
                <span style={{ fontSize: 12, color: t.textMuted, flexShrink: 0, marginLeft: 8 }}>{timeSince(item.startTime)}</span>
              </div>
            );
          })}
        </div>
      )}

      {editEntry && (
        <EditEntryModal entry={editEntry} t={t} onSave={handleSaveEdit} onDelete={handleDeleteEntry} onClose={() => setEditEntry(null)} />
      )}
    </div>
  );
}

// ─── Settings Screen ──────────────────────────────────────────────────
// ✅ FIX 4: Added sync status panel
function SettingsScreen({ profile, onSave, darkMode, onToggleTheme, t, showToast, syncStatus, lastSynced, isOnline, onManualSync }) {
  const [form, setForm] = useState({ nickname: "", dob: "", gender: "", feedingType: "", birthWeight: "", city: "", notes: "", ageFormat: "Weeks", ...profile });
  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  function handleSave() {
    const updated = { ...form, theme: darkMode ? "dark" : "light" };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    onSave(updated);
    showToast("Profile saved!");
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

  const syncColor = syncStatus === "synced" ? "#6BCB77" : syncStatus === "syncing" ? t.accent : syncStatus === "error" ? "#FF6B6B" : t.textMuted;
  const syncLabel = syncStatus === "synced" ? "Synced" : syncStatus === "syncing" ? "Syncing..." : syncStatus === "error" ? "Sync failed" : "Not synced";
  const syncIcon  = syncStatus === "synced" ? "fa-solid fa-circle-check" : syncStatus === "syncing" ? "fa-solid fa-spinner fa-spin" : syncStatus === "error" ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-cloud-arrow-up";

  return (
    <div style={{ padding: "24px 16px 100px" }}>
      <div style={{ fontSize: 18, fontWeight: "700", marginBottom: 4 }}>Baby Profile</div>
      <div style={{ fontSize: 13, color: t.textSub, marginBottom: 20, fontWeight: "600" }}>Helps BabySense AI make smarter predictions</div>

      <div style={{ background: t.card, borderRadius: 20, padding: "20px 18px", border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 22 }}>

        <div>{fieldLabel("fa-solid fa-tag","Baby Nickname")}<input style={inputStyle} placeholder="e.g. Arya, Lil One..." value={form.nickname} onChange={e => set("nickname", e.target.value)} /></div>
        <div>
          {fieldLabel("fa-solid fa-cake-candles","Date of Birth")}
          <input style={inputStyle} type="date" value={form.dob} onChange={e => set("dob", e.target.value)} />
          {getAge(form.dob,"Weeks") && <span style={{ fontSize: 11, color: t.textMuted, marginTop: 6, display: "block" }}>{getAge(form.dob,"Weeks")}</span>}
        </div>
        <div>
          {fieldLabel("fa-solid fa-user","Gender")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[{l:"Girl",v:"Girl",c:"#FF6B9D"},{l:"Boy",v:"Boy",c:"#6B8CFF"},{l:"Prefer not to say",v:"Prefer not to say",c:"#C4956A"}].map(g => <button key={g.v} onClick={() => set("gender",g.v)} style={optBtn(form.gender===g.v,g.c)}>{g.l}</button>)}
          </div>
          {form.gender && <span style={{ fontSize: 11, color: previewAccent, marginTop: 6, display: "block", fontWeight: "600" }}>Accent color updates to match</span>}
        </div>
        <div>
          {fieldLabel("fa-solid fa-bottle-droplet","Feeding Type")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["Breastfed","Formula","Both"].map(f => <button key={f} onClick={() => set("feedingType",f)} style={optBtn(form.feedingType===f)}>{f}</button>)}
          </div>
        </div>
        <div>{fieldLabel("fa-solid fa-weight-scale","Birth Weight (kg)")}<input style={inputStyle} placeholder="e.g. 3.2" value={form.birthWeight} onChange={e => set("birthWeight", e.target.value)} /></div>
        <div>
          {fieldLabel("fa-solid fa-location-dot","City")}
          <input style={inputStyle} placeholder="e.g. Ahmedabad" value={form.city} onChange={e => set("city", e.target.value)} />
          <span style={{ fontSize: 11, color: t.textMuted, marginTop: 6, display: "block" }}>Used for weather-aware predictions</span>
        </div>
        <div>{fieldLabel("fa-solid fa-note-sticky","Special Notes")}<textarea style={{ ...inputStyle, height: 80, resize: "none" }} placeholder="e.g. premature, colic, allergies..." value={form.notes} onChange={e => set("notes", e.target.value)} /></div>
        <div>
          {fieldLabel("fa-solid fa-calendar-days","Age Display Format")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["Days","Weeks","Months","Years"].map(f => <button key={f} onClick={() => set("ageFormat",f)} style={optBtn(form.ageFormat===f)}>{f}</button>)}
          </div>
          {agePreview && form.dob && <span style={{ fontSize: 11, color: t.textMuted, marginTop: 6, display: "block" }}>Preview: {agePreview}</span>}
        </div>
        <div>
          {fieldLabel("fa-solid fa-circle-half-stroke","Theme")}
          <div style={{ display: "flex", gap: 8 }}>
            {[{l:"Dark",v:true},{l:"Light",v:false}].map(m => <button key={m.l} onClick={() => onToggleTheme(m.v)} style={optBtn(darkMode===m.v)}>{m.l}</button>)}
          </div>
        </div>

        <button onClick={handleSave} style={{ width: "100%", border: "none", borderRadius: 16, padding: "16px", background: `linear-gradient(135deg, ${previewAccent}, #a78bfa)`, color: "#fff", fontSize: 16, fontWeight: "700", cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
          <i className="fa-solid fa-circle-check" style={{ marginRight: 8 }} />Save Profile
        </button>
      </div>

      {/* ✅ FIX 4: Sync Status Panel */}
      {SHEETS_URL && (
        <div style={{ background: t.card, borderRadius: 20, padding: "18px", border: `1px solid ${t.border}`, marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: "700", color: t.text, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <i className="fa-brands fa-google" style={{ color: "#34A853" }} />Google Sheets Sync
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i className={syncIcon} style={{ color: syncColor, fontSize: 15 }} />
              <span style={{ fontSize: 13, color: syncColor, fontWeight: "600" }}>{syncLabel}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: isOnline ? "#6BCB77" : "#FF6B6B" }} />
              <span style={{ fontSize: 12, color: t.textMuted }}>{isOnline ? "Online" : "Offline"}</span>
            </div>
          </div>
          {lastSynced && (
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>
              Last synced: {new Date(lastSynced).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })} · {new Date(lastSynced).toLocaleDateString("en-IN")}
            </div>
          )}
          <button
            onClick={onManualSync}
            disabled={syncStatus === "syncing" || !isOnline}
            style={{ width: "100%", padding: "12px", borderRadius: 14, border: `1px solid #34A853`, background: syncStatus === "syncing" || !isOnline ? t.bg3 : "#34A85318", color: syncStatus === "syncing" || !isOnline ? t.textMuted : "#34A853", fontWeight: "700", fontSize: 14, cursor: syncStatus === "syncing" || !isOnline ? "default" : "pointer", fontFamily: "'Poppins', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s" }}>
            <i className={syncStatus === "syncing" ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-rotate"} />
            {syncStatus === "syncing" ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────
function TabBar({ tab, setTab, t }) {
  const tabs = [
    { id: "home",     icon: "fa-solid fa-house",       label: "Home"     },
    { id: "stats",    icon: "fa-solid fa-chart-simple", label: "Stats"    },
    { id: "settings", icon: "fa-solid fa-gear",         label: "Settings" },
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
// ✅ FIX 2: Auth gate moved AFTER all hooks (no hooks-order violation)
export default function App() {
  const [authed,      setAuthed]      = useState(() => sessionStorage.getItem("bs_auth") === "1");
  const [log,         setLog]         = useState(() => loadLog());
  const [profile,     setProfile]     = useState(() => loadProfile());
  const [tab,         setTab]         = useState("home");
  const [activeModal, setActiveModal] = useState(null);
  const [prediction,  setPrediction]  = useState("Log a few events and I'll start predicting patterns.");
  const [aiLoading,   setAiLoading]   = useState(false);
  const [darkMode,    setDarkMode]    = useState(() => { const p = loadProfile(); return p.theme === "light" ? false : p.theme === "dark" ? true : isNightTime(); });
  const [toast,       setToast]       = useState({ visible: false, message: "" });
  const [syncStatus,  setSyncStatus]  = useState("idle");
  const [lastSynced,  setLastSynced]  = useState(null);
  const [isOnline,    setIsOnline]    = useState(navigator.onLine);
  const aiTimer = useRef(null);
  const t = getTheme(darkMode, profile.gender);

  // ✅ All useEffects BEFORE auth gate
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    if (isOnline) handleSync(log);
  }, [log]);

  useEffect(() => {
    const onOnline  = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const p = loadProfile();
      if (!p.theme) setDarkMode(isNightTime());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  function showToast(message) {
    setToast({ visible: true, message });
    setTimeout(() => setToast({ visible: false, message }), 2500);
  }

  async function handleSync(currentLog) {
    if (!SHEETS_URL || !isOnline) return;
    setSyncStatus("syncing");
    try {
      await syncToSheets(currentLog, profile);
      setSyncStatus("synced");
      setLastSynced(Date.now());
    } catch {
      setSyncStatus("error");
    }
  }

  async function onManualSync() {
    await handleSync(log);
    showToast("Synced to Google Sheets!");
  }

  const refreshPrediction = useCallback(async (currentLog) => {
    setAiLoading(true);
    setPrediction(await getAIPrediction(currentLog, profile));
    setAiLoading(false);
  }, [profile]);

  function handleSaveEntry(eventType, data) {
    const ev    = EVENT_TYPES.find(e => e.type === eventType);
    const entry = { ...data, type: eventType, label: ev.label, icon: ev.icon, streak: ev.streak, id: Date.now() };
    const newLog = [entry, ...log.slice(0, 49)];
    setLog(newLog);
    setActiveModal(null);
    showToast(`${ev.label} logged!`);
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => refreshPrediction(newLog), 2000);
  }

  function handleToggleTheme(isDark) {
    setDarkMode(isDark);
    setProfile(prev => {
      const u = { ...prev, theme: isDark ? "dark" : "light" };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(u));
      return u;
    });
  }

  const ageText  = getAge(profile.dob, profile.ageFormat || "Weeks");
  const activeEv = EVENT_TYPES.find(e => e.type === activeModal);

  // ✅ FIX 2: Auth gate is here — AFTER all hooks
  if (!authed) return <AuthScreen t={t} onUnlock={() => setAuthed(true)} />;

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'Poppins', sans-serif", maxWidth: 420, margin: "0 auto" }}>
      <div style={{ padding: "20px 16px 12px", borderBottom: `1px solid ${t.border}`, background: t.bg, position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ fontSize: 20, fontWeight: "700", letterSpacing: "-0.3px" }}>BabySense AI</div>
        <div style={{ fontSize: 13, color: t.textSub, fontWeight: "600", marginTop: 2 }}>
          {profile.nickname ? `${profile.nickname}'s Tracker` : "Your smart newborn assistant"}{ageText ? ` · ${ageText}` : ""}
        </div>
      </div>

      {tab === "home"     && <HomeScreen     log={log} prediction={prediction} aiLoading={aiLoading} t={t} setActiveModal={setActiveModal} onSaveEntry={handleSaveEntry} profile={profile} />}
      {tab === "stats"    && <StatsScreen    log={log} setLog={setLog} t={t} showToast={showToast} />}
      {tab === "settings" && <SettingsScreen profile={profile} onSave={p => { setProfile(p); setDarkMode(p.theme === "light" ? false : p.theme === "dark" ? true : isNightTime()); }} darkMode={darkMode} onToggleTheme={handleToggleTheme} t={t} showToast={showToast} syncStatus={syncStatus} lastSynced={lastSynced} isOnline={isOnline} onManualSync={onManualSync} />}

      <TabBar tab={tab} setTab={setTab} t={t} />

      {activeModal && activeEv && activeEv.type === "diaper" && (
        <DiaperModal t={t} onSave={d => handleSaveEntry(activeModal, d)} onClose={() => setActiveModal(null)} />
      )}
      {activeModal && activeEv && activeEv.type !== "diaper" && (
        <TimerModal ev={activeEv} t={t} onSave={d => handleSaveEntry(activeModal, d)} onClose={() => setActiveModal(null)} />
      )}
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
}
