import { useState, useEffect, useCallback, useRef } from "react";

const EVENTS = [
  { type: "feed",   emoji: "🍼", label: "Feed",   color: "#FF6B6B", glow: "#FF6B6B" },
  { type: "sleep",  emoji: "💤", label: "Sleep",  color: "#6B8CFF", glow: "#6B8CFF" },
  { type: "diaper", emoji: "💧", label: "Diaper", color: "#FFD93D", glow: "#FFD93D" },
  { type: "cry",    emoji: "😢", label: "Cry",    color: "#6BCB77", glow: "#6BCB77" },
];

const STORAGE_KEY = "babysense_log";
const PROFILE_KEY = "babysense_profile";
const API_KEY = import.meta.env.VITE_GEMINI_KEY;

function timeAgo(date) {
  const mins = Math.floor((Date.now() - date) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

function getAgeInWeeks(dob) {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
}

function loadLog() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; }
  catch { return {}; }
}

async function getAIPrediction(log, profile) {
  if (!API_KEY) return "⚠️ API key not set — check Vercel environment variables.";
  if (log.length < 2) return "Log a few more events and I'll start predicting patterns 🔍";

  const summary = log.slice(0, 15).map(e => {
    const mins = Math.floor((Date.now() - e.time) / 60000);
    return `${e.label} (${mins} min ago)`;
  }).join(", ");

  const ageWeeks = getAgeInWeeks(profile.dob);
  const profileContext = profile.nickname ? `
Baby profile:
- Name: ${profile.nickname}
- Age: ${ageWeeks !== null ? `${ageWeeks} weeks old` : "unknown"}
- Gender: ${profile.gender || "unknown"}
- Feeding type: ${profile.feedingType || "unknown"}
- Birth weight: ${profile.birthWeight || "unknown"}
- Location: ${profile.city || "unknown"}
- Special notes: ${profile.notes || "none"}
` : "";

  const prompt = `You are a warm, smart baby care assistant.${profileContext}
Recent baby events (most recent first): ${summary}.
Based on these patterns and the baby's profile, predict what the baby likely needs next and approximately when. Be specific, warm, and concise — max 2 sentences. Start directly with the prediction.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 120, temperature: 0.7 },
        }),
      }
    );
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Analyzing patterns... tap more events to improve predictions.";
  } catch {
    return "Couldn't reach AI right now — check your connection.";
  }
}

// ─── Settings Screen ───────────────────────────────────────────────
function SettingsScreen({ profile, onSave, onBack }) {
  const [form, setForm] = useState({
    nickname: "", dob: "", gender: "", feedingType: "",
    birthWeight: "", city: "", notes: "", ...profile
  });

  function handleChange(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  function handleSave() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(form));
    onSave(form);
    onBack();
  }

  const ageWeeks = getAgeInWeeks(form.dob);

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <div style={styles.logoRow}>
          <button onClick={onBack} style={styles.backBtn}>← Back</button>
          <span style={styles.logo}>⚙️ Baby Profile</span>
        </div>
        <span style={styles.sub}>Helps AI make smarter predictions</span>
        <div style={styles.divider} />
      </div>

      <div style={styles.settingsBox}>

        {/* Nickname */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>👶 Baby Nickname</label>
          <input
            style={styles.input}
            placeholder="e.g. Arya, Lil One..."
            value={form.nickname}
            onChange={e => handleChange("nickname", e.target.value)}
          />
        </div>

        {/* Date of Birth */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>🎂 Date of Birth</label>
          <input
            style={styles.input}
            type="date"
            value={form.dob}
            onChange={e => handleChange("dob", e.target.value)}
          />
          {ageWeeks !== null && (
            <span style={styles.hint}>
              {ageWeeks < 1 ? "Less than 1 week old 🌟" : `${ageWeeks} weeks old`}
            </span>
          )}
        </div>

        {/* Gender */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>🩷 Gender</label>
          <div style={styles.optionRow}>
            {["Girl", "Boy", "Prefer not to say"].map(g => (
              <button
                key={g}
                onClick={() => handleChange("gender", g)}
                style={{ ...styles.optionBtn, ...(form.gender === g ? styles.optionBtnActive : {}) }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Feeding Type */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>🍼 Feeding Type</label>
          <div style={styles.optionRow}>
            {["Breastfed", "Formula", "Both"].map(f => (
              <button
                key={f}
                onClick={() => handleChange("feedingType", f)}
                style={{ ...styles.optionBtn, ...(form.feedingType === f ? styles.optionBtnActive : {}) }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Birth Weight */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>⚖️ Birth Weight (kg)</label>
          <input
            style={styles.input}
            placeholder="e.g. 3.2"
            value={form.birthWeight}
            onChange={e => handleChange("birthWeight", e.target.value)}
          />
        </div>

        {/* City */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>📍 City</label>
          <input
            style={styles.input}
            placeholder="e.g. Ahmedabad"
            value={form.city}
            onChange={e => handleChange("city", e.target.value)}
          />
          <span style={styles.hint}>Used for weather-aware predictions</span>
        </div>

        {/* Notes */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>📝 Special Notes</label>
          <textarea
            style={{ ...styles.input, height: 80, resize: "none" }}
            placeholder="e.g. premature, colic, allergies..."
            value={form.notes}
            onChange={e => handleChange("notes", e.target.value)}
          />
        </div>

        <button onClick={handleSave} style={styles.saveBtn}>
          ✅ Save Profile
        </button>

      </div>
      <div style={styles.footer}>made with 💙 for tired parents</div>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────
export default function App() {
  const [log, setLog] = useState(() => loadLog());
  const [profile, setProfile] = useState(() => loadProfile());
  const [flash, setFlash] = useState(null);
  const [newItem, setNewItem] = useState(null);
  const [saved, setSaved] = useState(false);
  const [prediction, setPrediction] = useState("Tap a button below to start tracking 👇");
  const [aiLoading, setAiLoading] = useState(false);
  const [screen, setScreen] = useState("main");
  const aiTimer = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    if (log.length > 0) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }, [log]);

  const refreshPrediction = useCallback(async (currentLog) => {
    setAiLoading(true);
    const result = await getAIPrediction(currentLog, profile);
    setPrediction(result);
    setAiLoading(false);
  }, [profile]);

  function handleTap(event) {
    const entry = { ...event, time: Date.now(), id: Date.now() };
    const newLog = [entry, ...log.slice(0, 19)];
    setLog(newLog);
    setFlash(event.type);
    setNewItem(entry.id);
    setTimeout(() => setFlash(null), 600);
    setTimeout(() => setNewItem(null), 800);
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => refreshPrediction(newLog), 2000);
  }

  function clearLog() {
    if (window.confirm("Clear all events?")) {
      setLog([]);
      localStorage.removeItem(STORAGE_KEY);
      setPrediction("Tap a button below to start tracking 👇");
    }
  }

  const last = log[0];
  const ageWeeks = getAgeInWeeks(profile.dob);

  if (screen === "settings") {
    return <SettingsScreen profile={profile} onSave={setProfile} onBack={() => setScreen("main")} />;
  }

  return (
    <div style={styles.wrapper}>

      <div style={styles.header}>
        <div style={styles.logoRow}>
          <span style={styles.logo}>
            🌙 {profile.nickname ? `${profile.nickname}'s Tracker` : "BabySense AI"}
          </span>
          <button onClick={() => setScreen("settings")} style={styles.settingsBtn}>⚙️</button>
        </div>
        {profile.nickname && ageWeeks !== null && (
          <span style={styles.ageBadge}>👶 {ageWeeks} weeks old</span>
        )}
        {!profile.nickname && <span style={styles.sub}>Your smart newborn assistant</span>}
        {saved && <span style={styles.savedBadge}>✓ saved</span>}
        <div style={styles.divider} />
      </div>

      <div style={styles.card}>
        <div style={styles.cardLabel}>
          {aiLoading ? "🤖 AI is thinking..." : "✨ AI Prediction"}
        </div>
        <div style={{ ...styles.cardText, opacity: aiLoading ? 0.4 : 1, transition: "opacity 0.3s ease" }}>
          {prediction}
        </div>
        {last && (
          <div style={styles.cardSince}>
            Last event: <strong>{last.label}</strong> · {timeAgo(last.time)}
          </div>
        )}
      </div>

      <div style={styles.grid}>
        {EVENTS.map(ev => (
          <button
            key={ev.type}
            onClick={() => handleTap(ev)}
            style={{
              ...styles.btn,
              background: ev.color,
              boxShadow: flash === ev.type ? `0 0 24px 6px ${ev.glow}88` : `0 4px 18px ${ev.glow}44`,
              transform: flash === ev.type ? "scale(0.91)" : "scale(1)",
            }}
          >
            <span style={styles.btnEmoji}>{ev.emoji}</span>
            <span style={styles.btnLabel}>{ev.label}</span>
          </button>
        ))}
      </div>

      <div style={styles.logBox}>
        <div style={styles.logHeader}>
          <div style={styles.logTitle}>📋 Recent Events</div>
          {log.length > 0 && <button onClick={clearLog} style={styles.clearBtn}>clear all</button>}
        </div>
        {log.length === 0 && <div style={styles.logEmpty}>No events yet — tap above to log one</div>}
        {log.map((item) => (
          <div key={item.id} style={{ ...styles.logRow, opacity: newItem === item.id ? 0.4 : 1, transition: "opacity 0.4s ease" }}>
            <span style={styles.logLeft}>
              <span style={styles.logEmoji}>{item.emoji}</span>
              <span style={styles.logName}>{item.label}</span>
            </span>
            <span style={styles.logTime}>{timeAgo(item.time)}</span>
          </div>
        ))}
      </div>
      <div style={styles.footer}>made with 💙 for tired parents</div>
    </div>
  );
}

const styles = {
  wrapper:        { minHeight: "100vh", background: "#0b0b18", color: "#fff", fontFamily: "'Poppins', sans-serif", maxWidth: 420, margin: "0 auto", padding: "24px 16px 40px" },
  header:         { textAlign: "center", marginBottom: 22 },
  logoRow:        { display: "flex", justifyContent: "center", alignItems: "center", gap: 10 },
  logo:           { fontSize: 22, fontWeight: "700", letterSpacing: "-0.5px" },
  settingsBtn:    { background: "none", border: "none", fontSize: 20, cursor: "pointer", marginLeft: 6 },
  backBtn:        { background: "none", border: "none", color: "#6B8CFF", fontSize: 14, cursor: "pointer", fontFamily: "'Poppins', sans-serif", fontWeight: "600" },
  ageBadge:       { fontSize: 13, color: "#FFD93D", display: "block", marginTop: 4, fontWeight: "600" },
  savedBadge:     { fontSize: 11, background: "#6BCB7733", color: "#6BCB77", padding: "3px 10px", borderRadius: 20, fontWeight: "600", display: "inline-block", marginTop: 6 },
  sub:            { fontSize: 13, color: "#6B8CFF", marginTop: 4, display: "block", fontWeight: "600" },
  divider:        { height: 1, background: "linear-gradient(to right, transparent, #2a2a4a, transparent)", marginTop: 18 },
  card:           { background: "linear-gradient(135deg, #1a1a2e, #16213e)", borderRadius: 20, padding: "20px 22px", marginBottom: 26, borderLeft: "4px solid #6B8CFF", boxShadow: "0 8px 32px #6B8CFF22" },
  cardLabel:      { fontSize: 11, color: "#6B8CFF", marginBottom: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5 },
  cardText:       { fontSize: 16, lineHeight: 1.6, color: "#e8e8f0", fontWeight: "600" },
  cardSince:      { fontSize: 12, color: "#666", marginTop: 10 },
  grid:           { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 26 },
  btn:            { border: "none", borderRadius: 22, padding: "30px 10px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, transition: "all 0.15s ease" },
  btnEmoji:       { fontSize: 38 },
  btnLabel:       { fontSize: 16, fontWeight: "700", color: "#1a1a2e" },
  logBox:         { background: "#13131f", borderRadius: 20, padding: "18px 18px 6px", border: "1px solid #1e1e32" },
  logHeader:      { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  logTitle:       { fontSize: 12, color: "#555", fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5 },
  clearBtn:       { fontSize: 11, color: "#FF6B6B", background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins', sans-serif" },
  logEmpty:       { fontSize: 14, color: "#444", textAlign: "center", padding: "16px 0" },
  logRow:         { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #1a1a2e" },
  logLeft:        { display: "flex", alignItems: "center", gap: 10 },
  logEmoji:       { fontSize: 20 },
  logName:        { fontSize: 15, fontWeight: "600" },
  logTime:        { color: "#555", fontSize: 13 },
  footer:         { textAlign: "center", marginTop: 30, fontSize: 12, color: "#333" },
  settingsBox:    { background: "#13131f", borderRadius: 20, padding: "20px 18px", border: "1px solid #1e1e32" },
  fieldGroup:     { marginBottom: 22 },
  label:          { fontSize: 13, color: "#aaa", fontWeight: "600", display: "block", marginBottom: 8 },
  input:          { width: "100%", background: "#1e1e2e", border: "1px solid #2a2a4a", borderRadius: 12, padding: "12px 14px", color: "#fff", fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box" },
  hint:           { fontSize: 11, color: "#555", marginTop: 6, display: "block" },
  optionRow:      { display: "flex", gap: 8, flexWrap: "wrap" },
  optionBtn:      { background: "#1e1e2e", border: "1px solid #2a2a4a", borderRadius: 20, padding: "8px 16px", color: "#888", fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif" },
  optionBtnActive:{ background: "#6B8CFF22", border: "1px solid #6B8CFF", color: "#6B8CFF" },
  saveBtn:        { width: "100%", background: "linear-gradient(135deg, #6B8CFF, #a78bfa)", border: "none", borderRadius: 16, padding: "16px", color: "#fff", fontSize: 16, fontWeight: "700", cursor: "pointer", fontFamily: "'Poppins', sans-serif", marginTop: 8 },
};