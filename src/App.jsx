import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────
const STORAGE_KEY  = "babysense_log";
const PROFILE_KEY  = "babysense_profile";
const API_KEY      = import.meta.env.VITE_GEMINI_KEY;

const EVENT_TYPES = [
  { type: "feed",   emoji: "🍼", label: "Feed",   streak: "#FF6B6B" },
  { type: "sleep",  emoji: "💤", label: "Sleep",  streak: "#6B8CFF" },
  { type: "diaper", emoji: "💧", label: "Diaper", streak: "#FFD93D" },
  { type: "cry",    emoji: "😢", label: "Cry",    streak: "#6BCB77" },
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

function isNightTime() {
  const h = new Date().getHours();
  return h >= 21 || h < 6;
}

function loadLog()     { try { return JSON.parse(localStorage.getItem(STORAGE_KEY))  || []; } catch { return []; } }
function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch { return {}; } }

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
    accent, shadow: `${accent}33`,
    tabBg: "#0d0d14", tabBorder: "#1e1e2e",
  } : {
    bg: "#f7f7fc", bg2: "#ffffff", bg3: "#eeeef8",
    card: "#ffffff", border: "#e8e8f4", text: "#1a1a2e",
    textSub: accent, textMuted: "#999", textFaint: "#ccc",
    accent, shadow: `${accent}22`,
    tabBg: "#ffffff", tabBorder: "#e8e8f4",
  };
}

// ─── AI ───────────────────────────────────────────────────────────────
async function getAIPrediction(log, profile) {
  if (!API_KEY)        return "⚠️ API key not set.";
  if (log.length < 2)  return "Log a few more events and I'll start predicting patterns 🔍";
  const summary = log.slice(0, 15).map(e => `${e.label} (${Math.floor((Date.now() - e.time) / 60000)}min ago)`).join(", ");
  const age     = getAge(profile.dob, "Weeks");
  const ctx     = profile.nickname
    ? `Baby: ${profile.nickname}, ${age || "age unknown"}, ${profile.gender || ""}, ${profile.feedingType || ""} fed, in ${profile.city || "unknown city"}. Notes: ${profile.notes || "none"}.`
    : "";
  const prompt  = `You are a warm baby care assistant. ${ctx} Recent events: ${summary}. Predict the next need in max 2 warm, specific sentences. No intro phrases.`;
  try {
    const res  = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 120, temperature: 0.7 } }),
    });
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Analyzing patterns...";
  } catch { return "Couldn't reach AI — check connection."; }
}

// ─── Stats Tab ────────────────────────────────────────────────────────
function StatsScreen({ log, t }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayLog = log.filter(e => e.time >= today.getTime());
  const counts   = { feed: 0, sleep: 0, diaper: 0, cry: 0 };
  todayLog.forEach(e => { if (counts[e.type] !== undefined) counts[e.type]++; });

  const statCards = [
    { type: "feed",   emoji: "🍼", label: "Feeds",   count: counts.feed,   streak: "#FF6B6B" },
    { type: "sleep",  emoji: "💤", label: "Sleeps",  count: counts.sleep,  streak: "#6B8CFF" },
    { type: "diaper", emoji: "💧", label: "Diapers", count: counts.diaper, streak: "#FFD93D" },
    { type: "cry",    emoji: "😢", label: "Cries",   count: counts.cry,    streak: "#6BCB77" },
  ];

  const last24h = log.filter(e => e.time >= Date.now() - 86400000);

  return (
    <div style={{ padding: "24px 16px 100px" }}>
      <div style={{ fontSize: 18, fontWeight: "700", marginBottom: 6 }}>📊 Today's Summary</div>
      <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 20 }}>
        {today.toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
        {statCards.map(s => (
          <div key={s.type} style={{ background: t.card, borderRadius: 18, padding: "18px 16px", border: `1px solid ${t.border}`, borderLeft: `4px solid ${s.streak}`, boxShadow: `0 2px 12px ${t.shadow}` }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>{s.emoji}</div>
            <div style={{ fontSize: 32, fontWeight: "700", color: s.streak }}>{s.count}</div>
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>{s.label} today</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 15, fontWeight: "700", marginBottom: 12 }}>🕐 Last 24 Hours</div>
      {last24h.length === 0 ? (
        <div style={{ color: t.textMuted, fontSize: 14, textAlign: "center", padding: 20 }}>No events in the last 24 hours</div>
      ) : (
        <div style={{ background: t.card, borderRadius: 18, padding: "4px 16px", border: `1px solid ${t.border}` }}>
          {last24h.map((item, i) => (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: i < last24h.length - 1 ? `1px solid ${t.border}` : "none" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>{item.emoji}</span>
                <span style={{ fontSize: 14, fontWeight: "600" }}>{item.label}</span>
              </span>
              <span style={{ fontSize: 13, color: t.textMuted }}>{timeSince(item.time)}</span>
            </div>
          ))}
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

  const agePreview  = getAge(form.dob, form.ageFormat);
  const previewAccent = getAccent(form.gender);

  const inputStyle = { width: "100%", background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px", color: t.text, fontSize: 14, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box" };
  const optBtn = (active, color) => ({ background: active ? `${color || t.accent}18` : t.bg3, border: `1px solid ${active ? (color || t.accent) : t.border}`, borderRadius: 20, padding: "8px 16px", color: active ? (color || t.accent) : t.textMuted, fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif", transition: "all 0.2s" });
  const fieldLabel = (icon, text) => <label style={{ fontSize: 13, color: t.textMuted, fontWeight: "600", display: "block", marginBottom: 8 }}>{icon} {text}</label>;

  return (
    <div style={{ padding: "24px 16px 100px" }}>
      <div style={{ fontSize: 18, fontWeight: "700", marginBottom: 6 }}>⚙️ Baby Profile</div>
      <div style={{ fontSize: 13, color: t.textSub, marginBottom: 20, fontWeight: "600" }}>Helps BabySense AI make smarter predictions</div>

      <div style={{ background: t.card, borderRadius: 20, padding: "20px 18px", border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 22 }}>

        {/* 1. Nickname */}
        <div>{fieldLabel("👶", "Baby Nickname")}<input style={inputStyle} placeholder="e.g. Arya, Lil One..." value={form.nickname} onChange={e => set("nickname", e.target.value)} /></div>

        {/* 2. DOB */}
        <div>
          {fieldLabel("🎂", "Date of Birth")}
          <input style={inputStyle} type="date" value={form.dob} onChange={e => set("dob", e.target.value)} />
          {getAge(form.dob, "Weeks") && <span style={{ fontSize: 11, color: t.textMuted, marginTop: 6, display: "block" }}>{getAge(form.dob, "Weeks")}</span>}
        </div>

        {/* 3. Gender */}
        <div>
          {fieldLabel("👤", "Gender")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[{ l: "👧 Girl", v: "Girl", c: "#FF6B9D" }, { l: "👦 Boy", v: "Boy", c: "#6B8CFF" }, { l: "🤍 Prefer not to say", v: "Prefer not to say", c: "#C4956A" }]
              .map(g => <button key={g.v} onClick={() => set("gender", g.v)} style={optBtn(form.gender === g.v, g.c)}>{g.l}</button>)}
          </div>
          {form.gender && <span style={{ fontSize: 11, color: previewAccent, marginTop: 6, display: "block", fontWeight: "600" }}>● Accent color updates to match</span>}
        </div>

        {/* 4. Feeding */}
        <div>
          {fieldLabel("🍼", "Feeding Type")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["Breastfed", "Formula", "Both"].map(f => <button key={f} onClick={() => set("feedingType", f)} style={optBtn(form.feedingType === f)}>{f}</button>)}
          </div>
        </div>

        {/* 5. Birth Weight */}
        <div>{fieldLabel("⚖️", "Birth Weight (kg)")}<input style={inputStyle} placeholder="e.g. 3.2" value={form.birthWeight} onChange={e => set("birthWeight", e.target.value)} /></div>

        {/* 6. City */}
        <div>
          {fieldLabel("📍", "City")}
          <input style={inputStyle} placeholder="e.g. Ahmedabad" value={form.city} onChange={e => set("city", e.target.value)} />
          <span style={{ fontSize: 11, color: t.textMuted, marginTop: 6, display: "block" }}>Used for weather-aware predictions</span>
        </div>

        {/* 7. Notes */}
        <div>{fieldLabel("📝", "Special Notes")}<textarea style={{ ...inputStyle, height: 80, resize: "none" }} placeholder="e.g. premature, colic, allergies..." value={form.notes} onChange={e => set("notes", e.target.value)} /></div>

        {/* 8. Age Format */}
        <div>
          {fieldLabel("📅", "Age Display Format")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["Days", "Weeks", "Months", "Years"].map(f => <button key={f} onClick={() => set("ageFormat", f)} style={optBtn(form.ageFormat === f)}>{f}</button>)}
          </div>
          {agePreview && form.dob && <span style={{ fontSize: 11, color: t.textMuted, marginTop: 6, display: "block" }}>Preview: {agePreview}</span>}
        </div>

        {/* 9. Theme */}
        <div>
          {fieldLabel("🎨", "Theme")}
          <div style={{ display: "flex", gap: 8 }}>
            {[{ l: "🌙 Dark", v: true }, { l: "☀️ Light", v: false }].map(m => (
              <button key={m.l} onClick={() => onToggleTheme(m.v)} style={optBtn(darkMode === m.v)}>{m.l}</button>
            ))}
          </div>
        </div>

        <button onClick={handleSave} style={{ width: "100%", border: "none", borderRadius: 16, padding: "16px", background: `linear-gradient(135deg, ${previewAccent}, #a78bfa)`, color: "#fff", fontSize: 16, fontWeight: "700", cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
          ✅ Save Profile
        </button>
      </div>
    </div>
  );
}

// ─── Home Tab ─────────────────────────────────────────────────────────
function HomeScreen({ log, onTap, prediction, aiLoading, t, tappedType }) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const lastOf = (type) => log.find(e => e.type === type);

  return (
    <div style={{ padding: "16px 16px 100px" }}>

      {/* AI Prediction Card */}
      <div style={{ background: `linear-gradient(135deg, ${t.bg2}, ${t.bg3})`, borderRadius: 20, padding: "18px 20px", marginBottom: 20, borderLeft: `4px solid ${t.accent}`, boxShadow: `0 4px 20px ${t.shadow}` }}>
        <div style={{ fontSize: 11, color: t.accent, marginBottom: 8, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5 }}>
          {aiLoading ? "🤖 Thinking..." : "✨ AI Prediction"}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.6, color: t.text, fontWeight: "600", opacity: aiLoading ? 0.4 : 1, transition: "opacity 0.3s" }}>
          {prediction}
        </div>
      </div>

      {/* Event Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {EVENT_TYPES.map(ev => {
          const last    = lastOf(ev.type);
          const tapped  = tappedType === ev.type;
          return (
            <div
              key={ev.type}
              style={{
                background: t.card,
                borderRadius: 20,
                border: `1px solid ${t.border}`,
                borderLeft: `5px solid ${ev.streak}`,
                boxShadow: tapped ? `0 0 20px ${ev.streak}55` : `0 2px 12px ${t.shadow}`,
                transform: tapped ? "scale(0.97)" : "scale(1)",
                transition: "all 0.15s ease",
                display: "flex",
                alignItems: "center",
                padding: "18px 16px",
                gap: 14,
                cursor: "pointer",
              }}
              onClick={() => onTap(ev)}
            >
              {/* Emoji */}
              <span style={{ fontSize: 32, minWidth: 40, textAlign: "center" }}>{ev.emoji}</span>

              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: "700", color: t.text }}>{ev.label}</div>
                <div style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}>
                  {last ? `Last: ${timeSince(last.time)}` : "Not logged yet"}
                </div>
              </div>

              {/* Tap Button */}
              <button
                onClick={e => { e.stopPropagation(); onTap(ev); }}
                style={{
                  background: ev.streak, border: "none", borderRadius: 14,
                  width: 42, height: 42, fontSize: 22, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: `0 4px 12px ${ev.streak}66`,
                  flexShrink: 0,
                }}
              >
                +
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bottom Tab Bar ───────────────────────────────────────────────────
function TabBar({ tab, setTab, t }) {
  const tabs = [
    { id: "home",     emoji: "🏠", label: "Home"     },
    { id: "stats",    emoji: "📊", label: "Stats"    },
    { id: "settings", emoji: "⚙️",  label: "Settings" },
  ];
  return (
    <div style={{
      position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: 420,
      background: t.tabBg, borderTop: `1px solid ${t.tabBorder}`,
      display: "flex", zIndex: 100,
    }}>
      {tabs.map(tb => (
        <button key={tb.id} onClick={() => setTab(tb.id)} style={{
          flex: 1, border: "none", background: "none", padding: "12px 0 16px",
          cursor: "pointer", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 4, fontFamily: "'Poppins', sans-serif",
          transition: "all 0.15s",
        }}>
          <span style={{ fontSize: 22 }}>{tb.emoji}</span>
          <span style={{ fontSize: 11, fontWeight: "600", color: tab === tb.id ? t.accent : t.textMuted }}>
            {tb.label}
          </span>
          {tab === tb.id && (
            <div style={{ width: 20, height: 3, borderRadius: 2, background: t.accent, marginTop: 2 }} />
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────
export default function App() {
  const savedProfile                = loadProfile();
  const [log, setLog]               = useState(() => loadLog());
  const [profile, setProfile]       = useState(savedProfile);
  const [tab, setTab]               = useState("home");
  const [tappedType, setTappedType] = useState(null);
  const [prediction, setPrediction] = useState("Tap a button below to start tracking 👇");
  const [aiLoading, setAiLoading]   = useState(false);
  const [darkMode, setDarkMode]     = useState(() => {
    const p = loadProfile();
    if (p.theme === "light") return false;
    if (p.theme === "dark")  return true;
    return isNightTime();
  });
  const aiTimer = useRef(null);
  const t = getTheme(darkMode, profile.gender);

  // Auto night mode check every minute
  useEffect(() => {
    const interval = setInterval(() => {
      const p = loadProfile();
      if (!p.theme) setDarkMode(isNightTime());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  }, [log]);

  const refreshPrediction = useCallback(async (currentLog) => {
    setAiLoading(true);
    setPrediction(await getAIPrediction(currentLog, profile));
    setAiLoading(false);
  }, [profile]);

  function handleTap(event) {
    const entry  = { ...event, time: Date.now(), id: Date.now() };
    const newLog = [entry, ...log.slice(0, 49)];
    setLog(newLog);
    setTappedType(event.type);
    setTimeout(() => setTappedType(null), 400);
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => refreshPrediction(newLog), 2000);
  }

  function handleSaveProfile(p) {
    setProfile(p);
    setDarkMode(p.theme === "light" ? false : p.theme === "dark" ? true : isNightTime());
  }

  function handleToggleTheme(isDark) {
    setDarkMode(isDark);
    setProfile(prev => {
      const updated = { ...prev, theme: isDark ? "dark" : "light" };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  const ageText = getAge(profile.dob, profile.ageFormat || "Weeks");

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'Poppins', sans-serif", maxWidth: 420, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ padding: "20px 16px 8px", borderBottom: `1px solid ${t.border}`, background: t.bg }}>
        <div style={{ fontSize: 20, fontWeight: "700" }}>🌙 BabySense AI</div>
        <div style={{ fontSize: 13, color: t.textSub, fontWeight: "600", marginTop: 2 }}>
          {profile.nickname ? `${profile.nickname}'s Tracker${ageText ? ` (${ageText})` : ""}` : "Your smart newborn assistant"}
        </div>
      </div>

      {/* Tab Content */}
      <div style={{ overflowY: "auto" }}>
        {tab === "home" && (
          <HomeScreen log={log} onTap={handleTap} prediction={prediction} aiLoading={aiLoading} t={t} tappedType={tappedType} />
        )}
        {tab === "stats" && <StatsScreen log={log} t={t} />}
        {tab === "settings" && (
          <SettingsScreen profile={profile} onSave={handleSaveProfile} darkMode={darkMode} onToggleTheme={handleToggleTheme} t={t} />
        )}
      </div>

      {/* Bottom Tab Bar */}
      <TabBar tab={tab} setTab={setTab} t={t} />
    </div>
  );
}