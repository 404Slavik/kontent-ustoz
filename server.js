import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));
app.get("/", (req, res) => res.sendFile("index.html", { root: process.cwd() }));

const client = new Anthropic(); // ANTHROPIC_API_KEY muhit o‘zgaruvchisidan olinadi
const MODEL = "claude-haiku-5-5"; // arzon va tez
const LIMIT = Number(process.env.DAILY_FREE_LIMIT || 5);

const PLATFORMS = ["TikTok", "Instagram Reels", "YouTube Shorts", "YouTube (uzun video)"];

// Promptlar serverda: foydalanuvchi API'dan "bepul chat" sifatida foydalana olmaydi
const TOOLS = {
  title: (t, p, e) => `${p} uchun "${t}" mavzusidagi videoga ${e} ohangda 8 ta jozibali sarlavha yoz. O‘zbek tilida.`,
  tag: (t, p, e) => `${p} uchun "${t}" videosiga mos 15 ta hashtag tavsiya qil (auditoriya: ${e}). Ommabop va nisha hashtaglarni aralashtir. Har bir satr # bilan boshlansin.`,
  idea: (t, p, e) => `${p} uchun "${t}" mavzusida ${e} uslubda 8 ta video g‘oyasi ber. Har biri: qisqa nom + bir jumla ta’rif + boshlanish "hook". O‘zbek tilida.`,
  fmt: (t, p, e, to) => `"${t}" mavzusidagi video hozir ${p} uchun (${e}). Uni ${to} ga moslashtirish uchun 6 ta aniq maslahat ber: nisbat, davomiylik, subtitr, kadr, caption, hook. O‘zbek tilida.`,
};

// MUHIM: bu xotirada saqlanadi, server qayta ishga tushsa nolga tushadi.
// Ishga tushirishdan oldin PostgreSQL ga almashtiring (foydalanuvchi akkaunti bilan).
const usage = new Map();
const today = () => new Date().toISOString().slice(0, 10);
function getUsed(key) {
  const u = usage.get(key);
  return u && u.d === today() ? u.n : 0;
}

const clean = (s, max = 120) => String(s ?? "").replace(/[\n\r"]/g, " ").trim().slice(0, max);

app.post("/api/generate", async (req, res) => {
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
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    });
    const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const items = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (!Array.isArray(items)) throw new Error("format");
    usage.set(key, { d: today(), n: used + 1 });
    res.json({ items: items.map(String).slice(0, 20), left: LIMIT - used - 1 });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Xatolik, qayta urinib ko‘ring" });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("KontentUstoz ishga tushdi"));
