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
   SIMPLE IN-MEMORY SESSION
============================================================ */
const sessions = {}; // { [sessionId]: { ctaCooldown, hasPendingNeed } }

function getSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      ctaCooldown: 0,
      hasPendingNeed: false
    };
  }
  return sessions[sessionId];
}

/* ============================================================
   ZENVIA FACTS
============================================================ */
const ZENVIA_FACTS = `
Zenvia World – Fakta:
• Grundat: 2024 i Sverige
• Fokus: AI, automation, webbdesign, smarta affärssystem & digital tillväxt
• Uppdrag: Hjälpa företag växa med modern teknik och tydligare kundflöden
• Tjänster: AI-chattbotar, hemsidor, automatisering, marknadsföring, kundsystem
• Vision: Enkel, modern och automatiserad företagsdrift som skalar utan friktion
• Team: Entreprenörer med bakgrund inom marknadsföring, AI och UX-design
• Kundtyp: Småföretag, byråer, e-handel, hantverkare, tjänsteföretag och startups
• Varför AI: För att företag ska slippa manuellt arbete och kunna fokusera på kärnverksamheten
`.trim();

/* ============================================================
   INTENT CLASSIFIER
============================================================ */
async function classifyMessage(message) {
  const prompt = `
Klassificera följande meddelande i EN kategori:

"${message}"

Kategorier:
- smalltalk
- compliment
- insult
- neutral_fact
- business_need
- cta_trigger
- irrelevant

Svara ENDAST med kategorinamnet.
  `;

  const r = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "Strikt klassificerare." },
      { role: "user", content: prompt }
    ],
    max_tokens: 3,
    temperature: 0
  });

  return r.choices[0].message.content.trim();
}

/* ============================================================
   SERVICE DETECTION
============================================================ */
function detectServiceType(lower) {
  if (lower.includes("google ads") || lower.includes("sökordsannons") || lower.includes("google reklam"))
    return "google_ads";

  if (
    lower.includes("meta ads") ||
    lower.includes("facebook ads") ||
    (lower.includes("facebook") && lower.includes("annons")) ||
    (lower.includes("instagram") && lower.includes("annons"))
  )
    return "meta_ads";

  if (
    lower.includes("hemsida") ||
    lower.includes("webbsida") ||
    lower.includes("webbplats")
  )
    return "website";

  if (lower.includes("chattbot") || lower.includes("chatbot"))
    return "chatbot";

  if (lower.includes("automation") || lower.includes("automatisera"))
    return "automation";

  if (lower.includes("crm") || lower.includes("kundsystem"))
    return "crm";

  return null;
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

function respondWithCTA(res, session, baseText) {
  if (session.ctaCooldown > 0) {
    session.ctaCooldown--;
    return send(res, baseText);
  }
  session.ctaCooldown = 3;
  return sendCTA(res, baseText);
}

/* ============================================================
   MAIN ROUTE
============================================================ */
app.post("/chat", async (req, res) => {
  const userMessage = (req.body.message || "").trim();
  const lower = userMessage.toLowerCase();

  const sessionId = req.body.sessionId || "default";
  const session = getSession(sessionId);

  if (!userMessage) return send(res, "Skriv gärna något så hjälper jag dig vidare.");

  const intent = await classifyMessage(userMessage);

  /* ============================================================
     SMALLTALK
============================================================ */
  if (intent === "smalltalk") {
    if (lower.includes("vad heter du"))
      return send(res, "Jag heter Zenvia AI Assistant – redo att hjälpa dig när som helst.");
    if (lower.includes("hur mår du"))
      return send(res, "Jag mår alltid bra! Vad kan jag hjälpa dig med idag?");

    return send(res, "Jag är här och redo – vad vill du utforska?");
  }

  /* ============================================================
     COMPLIMENT
============================================================ */
  if (intent === "compliment") {
    return send(res, "Tack, kul att höra! Säg till om du vill utforska något.");
  }

  /* ============================================================
     INSULT
============================================================ */
  if (intent === "insult") {
    return send(res, "Jag tar inget personligt. Fokus är att hjälpa dig med digitala lösningar.");
  }

  /* ============================================================
     NEUTRAL FACT
============================================================ */
  if (intent === "neutral_fact") {
    return send(res, ZENVIA_FACTS);
  }

  /* ============================================================
     BUSINESS NEED — Alternativ B
============================================================ */
  if (intent === "business_need") {
    const service = detectServiceType(lower);

    if (!session.hasPendingNeed) {
      session.hasPendingNeed = true;

      if (service === "google_ads")
        return send(res, "Absolut — vi arbetar dagligen med Google Ads. Vad vill du uppnå med annonserna?");

      if (service === "meta_ads")
        return send(res, "Ja, vi hjälper med Meta Ads. Vad är målet med annonseringen?");

      if (service === "website")
        return send(res, "Det kan vi fixa — vad vill du att hemsidan ska lösa för dig?");

      if (service === "chatbot")
        return send(res, "Vi bygger smarta AI-chattbotar — vad vill du att den ska hjälpa dina kunder med?");

      return send(res, "Det låter som något vi kan hjälpa med. Vad vill du uppnå?");
    }

    // Second time → CTA
    session.hasPendingNeed = false;

    const service2 = detectServiceType(lower);
    let baseText;

    if (service2 === "google_ads")
      baseText = "Grymt — med Google Ads kan vi börja driva in fler relevanta kunder direkt.";
    else if (service2 === "meta_ads")
      baseText = "Perfekt — Meta Ads fungerar extremt bra för lokala tjänster och bokningar.";
    else if (service2 === "website")
      baseText = "En modern hemsida kan lyfta både tydlighet och konvertering direkt.";
    else if (service2 === "chatbot")
      baseText = "En AI-chattbot kan automatisera frågor och ge kunderna snabbare svar.";
    else
      baseText = "Det låter som att vi verkligen kan hjälpa er vidare.";

    return respondWithCTA(res, session, baseText);
  }

  /* ============================================================
     CTA TRIGGER
============================================================ */
  if (intent === "cta_trigger") {
    session.hasPendingNeed = false;
    const baseText = "Toppen! En konsultation är nästa steg för att sätta en tydlig plan.";
    return respondWithCTA(res, session, baseText);
  }

  /* ============================================================
     IRRELEVANT / FALLBACK
============================================================ */
  return send(res, "Jag hjälper gärna — berätta lite om ditt företag eller vad du vill göra.");
});

/* ============================================================
   START SERVER
============================================================ */
const PORT = process.env.PORT || process.env.port || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Zenvia AI Server running on port ${PORT}`);
});
