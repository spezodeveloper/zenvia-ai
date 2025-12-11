import express from "express";
import OpenAI from "openai";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ============================================================
   SESSION MEMORY
============================================================ */
const sessions = {}; 
function getSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      intent: null,
      industry: null,
      ctaCooldown: 0
    };
  }
  return sessions[sessionId];
}

/* ============================================================
   ZENVIA FACTS – hårdkodad & skyddad info
============================================================ */
const zenviaFacts = `
Zenvia World – Fakta:
• Grundat: 2024 i Sverige
• Fokus: AI, automation, webbdesign & digital tillväxt
• Vision: En modern, enkel och automatiserad företagsdrift
• Tjänster: AI-chattbotar, hemsidor, system & automation
• Team: Entreprenörer inom marknadsföring, AI och UX
• Kundtyper: Småföretag, e-handel, hantverkare, byråer & startups
• Varför AI: För att företag ska slippa manuellt arbete och växa snabbare
`;

/* ============================================================
   CLASSIFIER – ZEN-INTENT v2
============================================================ */
async function classifyMessage(message) {
  const prompt = `
Klassificera följande meddelande i EN kategori:

"${message}"

Kategorier:
- smalltalk (vardagligt prat, hur mår du, haha, wow, nice, lol, hype, ord som betyder typ "bra", "fett", "brutalt" osv)
- compliment (beröm, uppskattning, positiv reaktion)
- insult (förolämpning)
- neutral_fact (fakta om Zenvia: årtal, grundande, vision, plats, storlek, team, info)
- business_need (användaren uttrycker behov Zenvia löser: hemsida, ads, automation, chattbot, system)
- cta_trigger (användaren visar Tydlig köpsignal: "kan ni fixa det", "hur börjar vi", "kan vi köra", "vill ha hjälp", "boka")
- irrelevant (nonsens, spam)

Svara endast med kategorinamnet. Ingen förklaring.
  `;

  const r = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "Du är en strikt klassificeringsmotor." },
      { role: "user", content: prompt }
    ],
    max_tokens: 2,
    temperature: 0
  });

  return r.choices[0].message.content.trim();
}

/* ============================================================
   RESPONSE HELPERS
============================================================ */
function send(res, text) {
  return res.json({ reply: text });
}

function sendCTA(res, text) {
  return res.json({ reply: `${text}\n\n{{BOOK_CALL}}` });
}

/* ============================================================
   MAIN ENDPOINT
============================================================ */
app.post("/chat", async (req, res) => {
  const userMessageRaw = req.body.message || "";
  const userMessage = userMessageRaw.trim();
  const lower = userMessage.toLowerCase();

  const sessionId = req.body.sessionId || "default";
  const session = getSession(sessionId);

  /* ============================================================
       1 — CLASSIFY USER MESSAGE
  ============================================================= */
  const intent = await classifyMessage(userMessage);

  /* ============================================================
       HANDLE EACH CATEGORY
  ============================================================= */

  // SMALLTALK
  if (intent === "smalltalk") {
    return send(res, "Jag är Zenvias AI-assistent — alltid igång och redo att hjälpa! Vad vill du utforska?");
  }

  // COMPLIMENT
  if (intent === "compliment") {
    return send(res, "Tack, kul att höra! Bara säg till om du undrar något.");
  }

  // INSULT
  if (intent === "insult") {
    return send(res, "Jag tar inget personligt — vad vill du ha hjälp med?");
  }

  // NEUTRAL FACT
  if (intent === "neutral_fact") {
    return send(res, zenviaFacts.trim());
  }

  // BUSINESS NEED → förklara men INGEN CTA än
  if (intent === "business_need") {
    session.ctaCooldown = Math.max(session.ctaCooldown - 1, 0);

    return send(
      res,
      "Absolut — det kan vi hjälpa med. Berätta gärna lite om ditt företag eller målet, så guidar jag dig rätt."
    );
  }

  // CTA TRIGGER → Endast om cooldown OK
  if (intent === "cta_trigger") {
    if (session.ctaCooldown > 0) {
      session.ctaCooldown--;
      return send(res, "Toppen! Berätta lite mer så fortsätter vi.");
    }

    // reset cooldown
    session.ctaCooldown = 3;

    return sendCTA(
      res,
      "Perfekt — då är nästa steg att boka en konsultation så går vi igenom allt konkret."
    );
  }

  // IRRELEVANT
  if (intent === "irrelevant") {
    return send(res, "Jag är inte helt med — kan du formulera det lite annorlunda?");
  }

  /* ============================================================
     FALLBACK → Ifall classifier saknar kontext
  ============================================================= */
  return send(res, "Jag är här och hjälper gärna — berätta lite mer!");
});

/* ============================================================
   SERVER START
============================================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Zenvia AI Server running on port ${PORT}`);
});
