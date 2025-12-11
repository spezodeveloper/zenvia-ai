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
   SESSION SYSTEM
============================================================ */
const sessions = {}; // { sessionId: { ctaCooldown, lastIntent, lastFallback, industry, pendingNeed } }

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      ctaCooldown: 0,
      lastIntent: null,
      lastFallback: null,
      industry: null,
      pendingNeed: false
    };
  }
  return sessions[id];
}

/* ============================================================
   CONSTANTS
============================================================ */
const BOOK_CALL_TOKEN = "{{BOOK_CALL}}";

const ZENVIA_FACTS = `
Zenvia – Fakta:
• Grundat 2025 i Göteborg
• Fokus: AI, automation, webbdesign, kundsystem & digital tillväxt
• Tjänster: AI-chattbotar, hemsidor, automatisering, marknadsföring
• Vision: Enkel, modern och automatiserad företagsdrift
• Team: Entreprenörer inom AI, UX & marknadsföring
`.trim();

/* ============================================================
   INTENT CLASSIFIER — ADVANCED VERSION
============================================================ */
async function classify(message) {
  const prompt = `
Klassificera användarens meddelande i EN av följande intents:

SMALLTALK:
"hej", "hur mår du", "vad gör du", "nice", "wow", "lol" etc.

COMPLIMENT:
"du är bra", "fett nice", "shit va snyggt".

INSULT:
"du är ful", "du är dum", svordomar, attacker.

HOW_CAN_YOU_HELP:
"hur kan ni hjälpa mig", "vad gör ni", "vad erbjuder ni".

TRUST_ISSUE:
"jag litar inte på er", "är detta scam", "är ni legit".

PRICING_QUESTION:
"vad kostar det", "pris", "hur mycket tar ni".

WHEN_CAN_WE_START:
"hur snabbt kan vi börja", "kan vi starta", "hur lång tid tar det".

BUSINESS_NEED:
Behov = hemsida, marknadsföring, annonser, fler kunder, bokningar,
webbdesign, automation, CRM, online reklam, meta ads, google ads, 
"vill växa", "vill ha fler kunder", "vill ha mer bokningar".

CTA_DIRECT:
Direkta mål: "jag vill ha fler kunder", "mer bokningar", 
"jag vill sälja mer", "jag behöver fler leads", "vill skala".

COMPARE_US:
"varför ska man välja er", "är ni bättre än andra".

NEEDS_EXAMPLES:
"har ni exempel", "visa case", "något ni gjort".

PROBLEM_MODE:
"inget funkar", "vi får inga kunder", frustration.

NEUTRAL_FACT:
"när grundades ni", "berätta fakta om zenvia".

NON_HUMAN_UNINTELLIGIBLE:
Totalt nonsens: "asd98asd98", "#!#¤!#", etc.

FALLBACK:
Om inget matchar.

Returnera endast intent-namnet.
  `;

  const r = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "Du är en strikt intent-klassificerare." },
      { role: "user", content: prompt },
      { role: "user", content: `Meddelande: "${message}"` }
    ],
    max_tokens: 10,
    temperature: 0
  });

  return r.choices[0].message.content.trim();
}

/* ============================================================
   FUNKTIONSBLOCK: SENDERS
============================================================ */
function send(res, text) {
  return res.json({ reply: text });
}

function sendCTA(res, text) {
  return res.json({ reply: `${text}\n\n${BOOK_CALL_TOKEN}` });
}

function maybeCTA(res, session, text) {
  if (session.ctaCooldown > 0) {
    session.ctaCooldown--;
    return send(res, text);
  }
  session.ctaCooldown = 3;
  return sendCTA(res, text);
}

/* ============================================================
   FALLBACK VARIATIONS
============================================================ */
const FALLBACKS = [
  "Jag är med – vill du förklara lite mer?",
  "Det där var intressant 😄 vad menar du mer exakt?",
  "Spännande! Berätta gärna mer.",
  "Jag hänger med – vad vill du utforska?",
  "Låter som att det finns något bakom det där. Vill du utveckla?",
  "Förstår! Vad vill du komma fram till?"
];

function randomFallback(session) {
  let fallback;
  do {
    fallback = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
  } while (fallback === session.lastFallback);
  session.lastFallback = fallback;
  return fallback;
}

/* ============================================================
   MAIN AI CHAT ROUTE
============================================================ */
app.post("/chat", async (req, res) => {
  const msg = (req.body.message || "").trim();
  const lower = msg.toLowerCase();
  const sessionId = req.body.sessionId || "default";
  const session = getSession(sessionId);

  if (!msg) return send(res, "Skriv gärna något så hjälper jag dig vidare.");

  const intent = await classify(msg);
  session.lastIntent = intent;

  /* ============================================================
     INTENT HANDLING
============================================================ */

  // SMALLTALK
  if (intent === "SMALLTALK") {
    if (lower.includes("hur mår du"))
      return send(res, "Jag mår bra och är här för att hjälpa dig. Hur kan jag stötta dig vidare?");
    if (lower.includes("vad gör du"))
      return send(res, "Jag analyserar och försöker göra allt lite enklare för dig. Vad funderar du på?");
    return send(res, "Jag är här! Hur kan jag hjälpa dig med Zenvia?");
  }

  // COMPLIMENT
  if (intent === "COMPLIMENT")
    return send(res, "Tack! Säg gärna vad du vill utforska så hjälper jag dig.");

  // INSULT
  if (intent === "INSULT")
    return send(res, "Jag tar inget personligt – men jag hjälper dig gärna med Zenvia. Vad funderar du på?");

  // TRUST ISSUE
  if (intent === "TRUST_ISSUE")
    return sendCTA(res, "Det är helt okej att känna så. Om du vill prata med en människa kan du boka en konsultation här:");

  // PRICING
  if (intent === "PRICING_QUESTION")
    return sendCTA(res, "Priser varierar beroende på behov, men vi går igenom allt snabbt i en konsultation:");

  // WHEN CAN WE START
  if (intent === "WHEN_CAN_WE_START")
    return sendCTA(res, "Vi kan börja snabbt. Boka gärna en konsultation så planerar vi upp allt:");

  // HOW CAN YOU HELP
  if (intent === "HOW_CAN_YOU_HELP")
    return send(res,
      "Vi kan hjälpa dig växa med marknadsföring, moderna hemsidor, AI-chattbotar och smart automation. Vad vill ni förbättra just nu?"
    );

  // COMPARE US
  if (intent === "COMPARE_US")
    return send(res,
      "Vi fokuserar på skräddarsydda AI-lösningar, moderna kundflöden och personlig service. Vad vill ni förbättra mest?"
    );

  // NEEDS EXAMPLES
  if (intent === "NEEDS_EXAMPLES")
    return sendCTA(res, "Vi kan visa relevanta exempel för just er bransch – boka en kort konsultation här:");

  // NEUTRAL FACT
  if (intent === "NEUTRAL_FACT")
    return send(res, ZENVIA_FACTS);

  // PROBLEM MODE
  if (intent === "PROBLEM_MODE") {
    return send(res,
      "Förstår – många företag känner igen sig i det. Vad vill ni förbättra först: fler kunder, bättre struktur eller mindre manuellt arbete?"
    );
  }

  // CTA DIRECT
  if (intent === "CTA_DIRECT")
    return sendCTA(res, "Vi hjälper gärna med det. Boka en konsultation här:");

  // BUSINESS NEED
  if (intent === "BUSINESS_NEED") {
    if (!session.pendingNeed) {
      session.pendingNeed = true;
      return send(res,
        "Det låter som något vi kan hjälpa med. Vad vill du uppnå – fler kunder, fler bokningar eller bättre struktur?"
      );
    }
    session.pendingNeed = false;
    return sendCTA(res, "Grymt – då sätter vi planen tillsammans. Boka gärna en konsultation här:");
  }

  // NON-HUMAN / NONSENSE
  if (intent === "NON_HUMAN_UNINTELLIGIBLE")
    return send(res, "Jag hängde inte riktigt med – vill du skriva om det?");

  // FALLBACK
  return send(res, randomFallback(session));
});

/* ============================================================
   START SERVER
============================================================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Zenvia AI Server running on port ${PORT}`));
