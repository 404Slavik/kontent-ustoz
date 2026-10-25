import express from "express";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));
app.get("/", (req, res) => res.sendFile("index.html", { root: process.cwd() }));

const API_KEY = process.env.GEMINI_API_KEY;
// Model nomi o‘zgarsa, Render'da GEMINI_MODEL o‘zgaruvchisini yangilang
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const LIMIT = Number(process.env.DAILY_FREE_LIMIT || 5);

const PLATFORMS = ["TikTok", "Instagram Reels", "YouTube Shorts", "YouTube (uzun video)"];

const TOOLS = {
  title: (t, p, e) => `${p} uchun "${t}" mavzusidagi videoga ${e} ohangda 8 ta jozibali sarlavha yoz. O‘zbek tilida.`,
  tag: (t, p, e) => `${p} uchun "${t}" videosiga mos 15 ta hashtag tavsiya qil (auditoriya: ${e}). Ommabop va nisha hashtaglarni aralashtir. Har bir satr # bilan boshlansin.`,
  idea: (t, p, e) => `${p} uchun "${t}" mavzusida ${e} uslubda 8 ta video g‘oyasi ber. Har biri: qisqa nom + bir jumla ta’rif + boshlanish "hook". O‘zbek tilida.`,
  fmt: (t, p, e, to) => `"${t}" mavzusidagi video hozir ${p} uchun (${e}). Uni ${to} ga moslashtirish uchun 6 ta aniq maslahat ber: nisbat, davomiylik, subtitr, kadr, caption, hook. O‘zbek tilida.`,
};

// MUHIM: xotirada saqlanadi, server qayta ishga tushsa nolga tushadi.
// Pul olishdan oldin PostgreSQL ga almashtiring.
const usage = new Map();
const today = () => new Date().toISOString().slice(0, 10);
const getUsed = (key) => {
  const u = usage.get(key);
  return u && u.d === today() ? u.n : 0;
};
const clean = (s, max = 120) => String(s ?? "").replace(/[\n\r"]/g, " ").trim().slice(0, max);

async function askGemini(prompt) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2048 },
      }),
    }
  );
  if (!r.ok) {
    const err = new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  const d = await r.json();
  const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

app.post("/api/generate", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "Server sozlanmagan (API kalit yo‘q)" });
  const { tool, topic, platform, extra, to } = req.body || {};
  if (!TOOLS[tool]) return res.status(400).json({ error: "Noto‘g‘ri vosita" });
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: "Noto‘g‘ri platforma" });
  const t = clean(topic, 200);
  if (t.length < 3) return res.status(400).json({ error: "Mavzu juda qisqa" });

  const key = req.ip;
  const used = getUsed(key);
  if (used >= LIMIT) return res.status(429).json({ error: "Bugungi bepul limit tugadi", left: 0 });

  const prompt =
    TOOLS[tool](t, platform, clean(extra, 40), PLATFORMS.includes(to) ? to : platform) +
    "\nFaqat JSON massiv (satrlar) qaytar, boshqa matn yozma.";

  try {
    const items = await askGemini(prompt);
    if (!Array.isArray(items)) throw new Error("format");
    usage.set(key, { d: today(), n: used + 1 });
    res.json({ items: items.map(String).slice(0, 20), left: LIMIT - used - 1 });
  } catch (e) {
    console.error(e.message);
    // 503: Google'ning umumiy bepul limiti tugagan bo‘lishi mumkin
    if (e.status === 429) return res.status(503).json({ error: "Xizmat hozir band, birozdan keyin urinib ko‘ring" });
    res.status(500).json({ error: "Xatolik, qayta urinib ko‘ring" });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("KontentUstoz ishga tushdi"));
