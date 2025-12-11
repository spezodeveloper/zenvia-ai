/* ============================================================
   ZENVIA AI — ULTRA PREMIUM SERVER
   Features:
   - 30+ intents
   - Premium personality
   - CTA engine + cooldown
   - Variations to avoid repetition
   - Fuzzy service detection
   - Long-message summarizer
   - Off-topic handler
   - Human handoff intent
   - AI identity & bot origin
   - Experience intent
   - Video production intent
   - Pricing packages
   - Ads/web/automation/video/business logic
   - Natural Swedish tone
============================================================ */

import express from "express";
import OpenAI from "openai";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ============================================================
   SESSION HANDLER
============================================================ */
const sessions = {}; // sessionId: { ctaCooldown, lastIntent, industry, lastFallback, lastCTA, pendingNeed }
function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      ctaCooldown: 0,
      pendingNeed: false,
      lastIntent: null,
      lastFallback: null,
      lastCTA: null,
      industry: null
    };
  }
  return sessions[id];
}

const BOOK_CALL = "{{BOOK_CALL}}";

/* ============================================================
   ZENVIA FACTS (STRICT - ONLY USED WHEN ASKED)
============================================================ */
const ZENVIA_FACTS = `
Zenvia grundades 2025 i Göteborg.
Vi arbetar med AI, automation, webbdesign, marknadsföring, kunderflöden och digital tillväxt.
Vårt mål är att göra företagsdrift enklare, modern, skalbar och automatiserad.
`.trim();

/* ============================================================
   PREMIUM CTA RESPONSES (VARIERADE)
============================================================ */
const CTA_RESPONSES = [
  "Såklart – vi kan gå igenom allt under en konsultation. Boka gärna en tid här:",
  "Absolut! Vi visar er gärna allt i detalj under en kort konsultation. Tryck på knappen nedan:",
  "Självklart, det går vi igenom tillsammans. Boka gärna en konsultation här:",
  "Givetvis – under konsultationen visar vi exakt hur vi kan hjälpa er. Här kan du boka:",
  "Toppen! Vi tar allt steg för steg under en konsultation. Boka gärna med knappen under:",
  "Självklart, vi visar allt när vi pratar igenom upplägget. Boka här:"
];

/* ============================================================
   FALLBACK VARIATIONS (MER PREMIUM)
============================================================ */
const FALLBACKS = [
  "Jag tror jag förstår – vill du beskriva lite mer så hänger jag bättre med?",
  "Kan du utveckla det lite? Då kan jag guida dig vidare.",
  "Fattar! Säg gärna lite mer så hjälper jag dig vidare.",
  "Jag är med – vill du förklara lite mer?",
  "Okej! Berätta lite mer så fortsätter vi."
];

/* ============================================================
   BUSINESS NEED QUESTIONS (VARIATION)
============================================================ */
const BUSINESS_NEED_Q = [
  "Spännande – vad vill ni uppnå just nu? Fler kunder, fler bokningar eller bättre struktur?",
  "Grymt! Vad är huvudmålet – fler kunder, starkare struktur eller bättre bokningar?",
  "Förstår! Vad är viktigast att förbättra – kundflöde, bokningar eller interna rutiner?",
  "Kul att höra! Vad vill ni fokusera på: kunder, bokningar eller effektivitet?",
  "Låter bra! Är målet fler kunder, bättre struktur eller något annat?",
  "Absolut! Vad vill ni utveckla mest – marknadsföring, bokningar eller företagets struktur?"
];

/* ============================================================
   RANDOM PICKERS
============================================================ */
function pick(list, last) {
  let out;
  do out = list[Math.floor(Math.random() * list.length)];
  while (out === last);
  return out;
}

function send(res, text) {
  return res.json({ reply: text });
}
function sendCTA(res, session, text) {
  const CTA = pick(CTA_RESPONSES, session.lastCTA);
  session.lastCTA = CTA;
  return res.json({ reply: `${text}\n\n${CTA}\n\n${BOOK_CALL}` });
}

function maybeCTA(res, session, text) {
  if (session.ctaCooldown > 0) {
    session.ctaCooldown--;
    return send(res, text);
  }
  session.ctaCooldown = 3;
  return sendCTA(res, session, text);
}

/* ============================================================
   FUZZY SERVICE DETECTION
============================================================ */
function detectService(msg) {
  const m = msg.toLowerCase();

  if (m.includes("google") && (m.includes("ads") || m.includes("reklam")))
    return "google_ads";

  if (
    m.includes("meta") ||
    m.includes("facebook") && m.includes("annons") ||
    m.includes("instagram") && m.includes("annons")
  )
    return "meta_ads";

  if (m.includes("hemsida") || m.includes("web") || m.includes("webbplats"))
    return "website";

  if (m.includes("automation") || m.includes("automatisera"))
    return "automation";

  if (m.includes("crm") || m.includes("kundsystem"))
    return "crm";

  if (
    m.includes("video") ||
    m.includes("reklamvideo") ||
    m.includes("videoredigering")
  )
    return "video";

  if (m.includes("chattbot") || m.includes("chatbot"))
    return "chatbot";

  return null;
}

/* ============================================================
   INTENT CLASSIFIER — MEGA VERSION
============================================================ */
async function classify(message) {
  const prompt = `
Klassificera följande meddelande till EN intent.

INTENTS:
SMALLTALK — hej, hur mår du, vad gör du, nice
THANK_YOU — tack, tack så mycket
COMPLIMENT — du är grym, snyggt
INSULT — du är ful, svordomar
AI_IDENTITY — är du riktig? är du en ai?
BOT_ORIGIN — hur skapades du, vem byggde dig
EXPERIENCE — hur mycket erfarenhet har ni
COMPANY_AGE — hur länge har ni funnits, när grundades ni
WHERE_ARE_YOU — vart finns ni, var ligger ni
HUMAN_HANDOFF — prata med människa, riktig person
PRICING_QUESTION — vad kostar det, pris
PRICING_PACKAGE — har ni paket, prisplan
PROCESS_EXPLANATION — hur fungerar det, hur går processen till
EXPECTATION_MANAGEMENT — kan ni garantera resultat
HOW_CAN_YOU_HELP — hur kan ni hjälpa oss, vad gör ni
VIDEO_NEED — reklamvideo, videoproduktion
BUSINESS_NEED — marknadsföring, hemsida, automation, ads, crm
CTA_DIRECT — vill ha fler kunder, fler bokningar
UNCERTAIN_NEED — vet inte vad jag behöver
GENERIC_SERVICE_REQUEST — gör ni X? saker som ej på listan
PROBLEM_MODE — inget funkar, vi är stressade
NEEDS_EXAMPLES — visa exempel, har ni case
OFF_TOPIC — skriv något random, något konstigt
EMOJI_REACTION — 👍🔥😁
ACKNOWLEDGEMENT — ok, mm, ah ok
LONG_MESSAGE_SUMMARY — långa stycken
NON_HUMAN_UNINTELLIGIBLE — gds7f89asd,#¤
NEUTRAL_FACT — fakta om zenvia
FALLBACK — allt annat

Returnera endast intent-namnet.
`;

  const r = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    max_tokens: 10,
    temperature: 0,
    messages: [
      { role: "system", content: "Strikt klassificerare." },
      { role: "user", content: prompt },
      { role: "user", content: message }
    ]
  });

  return r.choices[0].message.content.trim();
}

/* ============================================================
   MAIN HANDLER
============================================================ */
app.post("/chat", async (req, res) => {
  const msg = (req.body.message || "").trim();
  const session = getSession(req.body.sessionId || "default");
  const lower = msg.toLowerCase();

  if (!msg) return send(res, "Skriv gärna något 😊");

  const intent = await classify(msg);
  session.lastIntent = intent;

  /* ===== INTENT ROUTING ===== */

  if (intent === "SMALLTALK")
    return send(res, "Jag är här! Hur kan jag hjälpa dig vidare?");

  if (intent === "THANK_YOU")
    return send(res, "Tack själv! Hur kan jag hjälpa dig vidare?");

  if (intent === "COMPLIMENT")
    return send(res, "Tack! Säg gärna vad du vill utforska så hjälper jag dig.");

  if (intent === "INSULT")
    return send(res, "Jag tar inget personligt – hur kan jag hjälpa dig med Zenvia?");

  if (intent === "AI_IDENTITY")
    return send(res, "Jag är en AI skapad av Zenvias utvecklare för att hjälpa företag.");

  if (intent === "BOT_ORIGIN")
    return send(res, "Jag skapades av en av Zenvias utvecklare som del av våra AI-system.");

  if (intent === "EXPERIENCE") {
    const replies = [
      "Vi har erfarna utvecklare och designers inom AI, webbutveckling, video, marknadsföring och automatisering.",
      "Vårt team har lång erfarenhet inom AI, webb, marknadsföring, design och automation.",
      "Vi jobbar med AI-system, hemsidor, marknadsföring, video och automation – med fokus på resultat."
    ];
    return send(res, pick(replies, session.lastFallback));
  }

  if (intent === "COMPANY_AGE")
    return send(res, "Zenvia grundades 2025 i Göteborg. Vi hjälper företag med AI, automation, hemsidor och marknadsföring.");

  if (intent === "WHERE_ARE_YOU")
    return send(res, "Just nu finns vi bara på www.zenvia.world.");

  if (intent === "HUMAN_HANDOFF")
    return sendCTA(res, session, "Självklart! Du kan prata med en människa genom att boka en konsultation här:");

  if (intent === "PRICING_QUESTION")
    return sendCTA(res, session, "Priser varierar efter behov – vi går igenom allt i en konsultation:");

  if (intent === "PRICING_PACKAGE")
    return sendCTA(res, session, "Vi skräddarsyr paket efter behov – boka en konsultation så tar vi det därifrån:");

  if (intent === "PROCESS_EXPLANATION")
    return send(res, "Vi börjar med en kort konsultation där vi går igenom ert behov, och därefter skapar vi en skräddarsydd AI- eller marknadsföringslösning.");

  if (intent === "EXPECTATION_MANAGEMENT")
    return sendCTA(res, session, "Vi arbetar datadrivet och fokuserar på resultat. Boka en konsultation så ser vi vad som är möjligt:");

  if (intent === "HOW_CAN_YOU_HELP")
    return send(res, "Vi hjälper företag växa med AI-chattbotar, marknadsföring, hemsidor och automation. Vad vill ni förbättra?");

  if (intent === "VIDEO_NEED")
    return sendCTA(res, session, "Ja! Vi kan skapa reklamvideor, redigera material och även producera AI-genererade videor. Boka konsultation här:");

  if (intent === "UNCERTAIN_NEED")
    return sendCTA(res, session, "Ingen fara – det är precis det konsultationen är till för. Boka gärna här så tar vi det steg för steg:");

  if (intent === "GENERIC_SERVICE_REQUEST")
    return send(res, "Vi hjälper med många digitala tjänster. Beskriv gärna lite mer så ser vi hur vi kan hjälpa er.");

  if (intent === "PROBLEM_MODE")
    return send(res, "Förstår – många företag känner igen sig i det. Vad vill ni förbättra först: fler kunder, automatisering eller hemsidan?");

  if (intent === "NEEDS_EXAMPLES")
    return sendCTA(res, session, "Såklart – vi kan visa exempel under konsultationen. Boka gärna här:");

  if (intent === "OFF_TOPIC") {
    const replies = [
      "Låt oss hålla oss till frågor som rör Zenvia – vad vill du utforska vidare?",
      "Jag fokuserar på Zenvias tjänster. Vill du prata AI, hemsidor eller marknadsföring?",
      "Jag hjälper dig gärna med Zenvia-relaterade frågor – vad funderar du på?",
      "Låt oss fokusera på det jag kan hjälpa dig med: AI, hemsidor, marknadsföring eller automation."
    ];
    return send(res, pick(replies, session.lastFallback));
  }

  if (intent === "EMOJI_REACTION" || intent === "ACKNOWLEDGEMENT")
    return send(res, "Toppen! Hur vill du gå vidare?");

  if (intent === "NON_HUMAN_UNINTELLIGIBLE")
    return send(res, "Jag hängde inte riktigt med – kan du formulera det på ett annat sätt?");

  if (intent === "LONG_MESSAGE_SUMMARY") {
    return send(res, "Tack för att du delar! Vill du att jag sammanfattar eller vill du förklara vad du vill förbättra först?");
  }

  /* ============================================================
     BUSINESS_NEED LOGIC
  ============================================================ */
  if (intent === "BUSINESS_NEED") {
    const service = detectService(lower);

    if (!session.pendingNeed) {
      session.pendingNeed = true;

      if (service === "video")
        return sendCTA(res, session, "Ja! Vi kan skapa reklamvideor, redigera material och producera AI-video. Boka konsultation här:");

      if (service === "automation")
        return send(res, "Vill ni främst spara tid, få mer struktur eller automatisera arbetsflöden?");

      return send(res, pick(BUSINESS_NEED_Q, session.lastFallback));
    }

    session.pendingNeed = false;
    return maybeCTA(res, session, "Grymt – då kan vi planera nästa steg！");
  }

  if (intent === "CTA_DIRECT")
    return sendCTA(res, session, "Det löser vi! Boka gärna en konsultation så sätter vi planen:");

  if (intent === "NEUTRAL_FACT")
    return send(res, ZENVIA_FACTS);

  /* ============================================================
     FALLBACK
  ============================================================ */
  return send(res, pick(FALLBACKS, session.lastFallback));
});

/* ============================================================
   SERVER START
============================================================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Zenvia AI Server running on port ${PORT}`));
