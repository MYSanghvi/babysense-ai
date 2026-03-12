import { useState, useEffect } from "react";

const EVENTS = [
  { type: "feed",   emoji: "🍼", label: "Feed",   color: "#FF6B6B", glow: "#FF6B6B" },
  { type: "sleep",  emoji: "💤", label: "Sleep",  color: "#6B8CFF", glow: "#6B8CFF" },
  { type: "diaper", emoji: "💧", label: "Diaper", color: "#FFD93D", glow: "#FFD93D" },
  { type: "cry",    emoji: "😢", label: "Cry",    color: "#6BCB77", glow: "#6BCB77" },
];

function timeAgo(date) {
  const mins = Math.floor((Date.now() - date) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

const PREDICTIONS = {
  feed:   "🍼 Fed recently — watch for sleepiness in 20–40 min",
  sleep:  "💤 Just woke up — a feed is likely needed soon",
  diaper: "💧 Fresh diaper — baby should be comfortable for a while",
  cry:    "😢 Crying logged — check feed & diaper if it continues",
};

const STORAGE_KEY = "babysense_log";

function loadLog() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export default function App() {
  const [log, setLog] = useState(() => loadLog());
  const [flash, setFlash] = useState(null);
  const [newItem, setNewItem] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    if (log.length > 0) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }, [log]);

  function handleTap(event) {
    const entry = { ...event, time: Date.now(), id: Date.now() };
    setLog(prev => [entry, ...prev.slice(0, 19)]);
    setFlash(event.type);
    setNewItem(entry.id);
    setTimeout(() => setFlash(null), 600);
    setTimeout(() => setNewItem(null), 800);
  }

  function clearLog() {
    if (window.confirm("Clear all events?")) {
      setLog([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const last = log[0];
  const prediction = last ? PREDICTIONS[last.type] : "Tap a button below to start tracking 👇";

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <div style={styles.logoRow}>
          <span style={styles.logo}>🌙 BabySense AI</span>
          {saved && <span style={styles.savedBadge}>✓ saved</span>}
        </div>
        <span style={styles.sub}>Your smart newborn assistant</span>
        <div style={styles.divider} />
      </div>

      <div style={styles.card}>
        <div style={styles.cardLabel}>✨ AI Prediction</div>
        <div style={styles.cardText}>{prediction}</div>
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
          {log.length > 0 && (
            <button onClick={clearLog} style={styles.clearBtn}>clear all</button>
          )}
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
  wrapper:    { minHeight: "100vh", background: "#0b0b18", color: "#fff", fontFamily: "'Poppins', sans-serif", maxWidth: 420, margin: "0 auto", padding: "24px 16px 40px" },
  header:     { textAlign: "center", marginBottom: 22 },
  logoRow:    { display: "flex", justifyContent: "center", alignItems: "center", gap: 10 },
  logo:       { fontSize: 26, fontWeight: "700", letterSpacing: "-0.5px" },
  savedBadge: { fontSize: 11, background: "#6BCB7733", color: "#6BCB77", padding: "3px 10px", borderRadius: 20, fontWeight: "600" },
  sub:        { fontSize: 13, color: "#6B8CFF", marginTop: 4, display: "block", fontWeight: "600" },
  divider:    { height: 1, background: "linear-gradient(to right, transparent, #2a2a4a, transparent)", marginTop: 18 },
  card:       { background: "linear-gradient(135deg, #1a1a2e, #16213e)", borderRadius: 20, padding: "20px 22px", marginBottom: 26, borderLeft: "4px solid #6B8CFF", boxShadow: "0 8px 32px #6B8CFF22" },
  cardLabel:  { fontSize: 11, color: "#6B8CFF", marginBottom: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5 },
  cardText:   { fontSize: 16, lineHeight: 1.6, color: "#e8e8f0", fontWeight: "600" },
  cardSince:  { fontSize: 12, color: "#666", marginTop: 10 },
  grid:       { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 26 },
  btn:        { border: "none", borderRadius: 22, padding: "30px 10px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, transition: "all 0.15s ease" },
  btnEmoji:   { fontSize: 38 },
  btnLabel:   { fontSize: 16, fontWeight: "700", color: "#1a1a2e" },
  logBox:     { background: "#13131f", borderRadius: 20, padding: "18px 18px 6px", border: "1px solid #1e1e32" },
  logHeader:  { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  logTitle:   { fontSize: 12, color: "#555", fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5 },
  clearBtn:   { fontSize: 11, color: "#FF6B6B", background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins', sans-serif" },
  logEmpty:   { fontSize: 14, color: "#444", textAlign: "center", padding: "16px 0" },
  logRow:     { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #1a1a2e" },
  logLeft:    { display: "flex", alignItems: "center", gap: 10 },
  logEmoji:   { fontSize: 20 },
  logName:    { fontSize: 15, fontWeight: "600" },
  logTime:    { color: "#555", fontSize: 13 },
  footer:     { textAlign: "center", marginTop: 30, fontSize: 12, color: "#333" },
};