// server.js
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { google } from "googleapis";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ============================================================
//  SIMPLE IN-MEMORY SESSION STORE
// ============================================================
const sessions = {}; // { [sessionId]: { intent, industry, heatScore, messageIndex, lastBookingIndex } }

function getSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      intent: null,
      industry: null,
      heatScore: 0,
      messageIndex: 0,
      lastBookingIndex: -10 // långt bak så första CTA alltid är ok
    };
  }
  return sessions[sessionId];
}

// ============================================================
//  CONSTANTS
// ============================================================
const BOOKING_TOKEN = "{{BOOK_CALL}}";

// Din interna Zenvia-knowledge base (INGET från Google)
const ZENVIA_KB = `
Zenvia World – Fakta & Information:

• Grundat: 2025 i Göteborg, Sverige.
• Fokus: AI, automation, webbdesign, smarta affärssystem och digital tillväxt.
• Uppdrag: Hjälpa företag växa med modern teknik och tydligare kundflöden.
• Tjänster: AI-chattbotar, hemsidor, automatisering, marknadsföring, kundsystem.
• Vision: Enkel, modern och automatiserad företagsdrift som skalar utan friktion.
• Team: Drivs av entreprenörer med bakgrund inom marknadsföring, AI och UX-design.
• Kundtyp: Småföretag, byråer, e-handel, hantverkare, tjänsteföretag och startups – i princip alla typer av företag.
• Varför AI: För att företag ska slippa manuellt arbete och kunna fokusera på sin kärnverksamhet.
`;

// ============================================================
//  GOOGLE SHEETS LOGGING
// ============================================================
async function logChatMessage(sessionId, sender, message, sessionSnapshot = {}) {
  try {
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const sheetId = process.env.GOOGLE_SHEETS_SHEET_ID;

    if (!clientEmail || !privateKey || !sheetId) {
      // Logging inte konfigurerad – hoppa tyst
      return;
    }

    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/spreadsheets"]
    );

    const sheets = google.sheets({ version: "v4", auth });

    const now = new Date().toISOString();
    const { intent, industry, heatScore } = sessionSnapshot;

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "A:G",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          now,
          sessionId,
          sender,
          message,
          heatScore ?? "",
          intent ?? "",
          industry ?? ""
        ]]
      }
    });
  } catch (err) {
    console.error("Failed to log to Google Sheets:", err.message);
  }
}

// ============================================================
//  BRANSCHDETEKTION (enkel + försiktig)
// ============================================================
const industryMap = {
  bygg: [" bygg", " hantverk", " snickare", " elektriker", " vvs ", " renovering"],
  ehandel: ["e-handel", "webshop", "webbutik", "shopify", "woocommerce"],
  restaurang: [" restaurang", " café ", " kafé ", " pizzeria ", " matställe "],
  konsult: [" konsult", " byrå", " agency", " rådgivare"],
  coaching: [" coach", " coaching", " terapeut", " mentor"],
  fastighet: [" mäklare", " fastighet", " hyresvärd", " lokaler"],
  utbildning: [" skola", " kurs", " kurser", " academy", " utbildning"],
  nyforetagare: [" nytt företag", " starta företag", " startar företag"]
};

async function detectIndustry(session, lower, userMessage) {
  if (session.industry) return;

  const safeLower = ` ${lower} `;
  let detected = null;

  for (const [industry, words] of Object.entries(industryMap)) {
    if (words.some(w => safeLower.includes(w))) {
      detected = industry;
      break;
    }
  }

  if (!detected) return;

  // Optionell AI-validering – extremt strikt
  try {
    const check = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "Svara endast 'ja' eller 'nej'. Var extremt strikt." },
        {
          role: "user",
          content: `Text: "${userMessage}"\nBranschgissning: ${detected}\nÄr detta med stor sannolikhet rätt bransch?`
        }
      ],
      max_tokens: 1,
      temperature: 0
    });

    const ans = (check.choices[0].message.content || "").trim().toLowerCase();
    if (ans === "ja") {
      session.industry = detected;
    }
  } catch (e) {
    // Om något går fel, skippa tyst
  }
}

// ============================================================
//  HEAT SCORE (light version)
// ============================================================
function updateHeatScore(session, lower) {
  let score = session.heatScore || 0;

  if (
    lower.includes("chattbot") ||
    lower.includes("chatbot") ||
    lower.includes("hemsida") ||
    lower.includes("webbsida") ||
    lower.includes("automation") ||
    lower.includes("automatisera")
  ) {
    score += 15;
  }

  if (
    lower.includes("kan ni göra") ||
    lower.includes("kan ni fixa") ||
    lower.includes("kan du göra") ||
    lower.includes("kan du fixa")
  ) {
    score += 20;
  }

  if (
    lower.includes("hur kommer man igång") ||
    lower.includes("hur kommer vi igång") ||
    lower.includes("hur börjar vi") ||
    lower.includes("jag vill boka") ||
    lower.includes("vill boka") ||
    lower.includes("vi vill boka")
  ) {
    score += 30;
  }

  if (
    lower.includes("pris") ||
    lower.includes("kostnad") ||
    lower.includes("kosta") ||
    lower.includes("budget")
  ) {
    score += 20;
  }

  // clamp
  if (score > 100) score = 100;
  session.heatScore = score;
}

// ============================================================
//  BOOKING TOKEN HELPER – MED COOLDOWN
//  Typ C: bara vid logiska triggers (behov / köpsignaler),
//  och aldrig "back-to-back": minst 3 sådana triggers emellan.
// ============================================================
function maybeAttachBookingToken(reply, session) {
  // logiska triggers i texten (vi kollar reply, men kunde varit userMessage också)
  const r = reply.toLowerCase();

  const isLogicalBookingTrigger =
    r.includes("boka en konsultation") ||
    r.includes("boka en tid") ||
    r.includes("nästa steg är att boka") ||
    r.includes("boka gärna en konsultation") ||
    r.includes("boka konsultation");

  if (!isLogicalBookingTrigger) {
    return reply; // ingen token alls
  }

  const canSend =
    session.messageIndex - session.lastBookingIndex >= 3;

  if (!canSend) {
    // för tidigt – vi kör texten men utan token
    return reply;
  }

  session.lastBookingIndex = session.messageIndex;
  return `${reply}\n\n${BOOKING_TOKEN}`;
}

// ============================================================
//  SYSTEM-PROMPT FÖR DEFAULT-SVAR
// ============================================================
function buildSystemPrompt(session) {
  return `
Du är Zenvia Worlds digitala assistent.

Ditt mål:
- Hjälpa användaren förstå vad Zenvia gör.
- Svara neutralt och naturligt på frågor.
- När användaren tydligt uttrycker ett behov Zenvia kan lösa, kan du kort berätta hur ni hjälper till och nämna att nästa steg ofta är en konsultation.
- Du ska INTE själv hitta på eller hämta information om Zenvia från internet – du får ENDAST använda följande fakta:

${ZENVIA_KB}

Regler:
- Svara kort (1–3 meningar).
- Ton: modern, trygg, professionell, lugn. Inga emojis.
- Inga priser eller prisnivåer – säg att pris beror på omfattning om det kommer upp.
- Du får gärna ställa enkla följdfrågor, men inte för mycket.
- Du får inte lägga till några tokens eller specialmarkeringar – frontend hanterar knappar.

Kontext om användaren:
- Intent: ${session.intent || "okänd"}
- Bransch: ${session.industry || "okänd"}
- Heat score: ${session.heatScore || 0}
`;
}

// ============================================================
//  ROUTE /chat
// ============================================================
app.post("/chat", async (req, res) => {
  const userMessageRaw = req.body.message || "";
  const userMessage = userMessageRaw.trim();
  const intent = req.body.intent || null;
  const sessionId = req.body.sessionId || "default-session";

  const session = getSession(sessionId);
  session.messageIndex += 1;
  if (intent) session.intent = intent;

  const lower = userMessage.toLowerCase();

  // uppdatera bransch + heatScore (asynkront + sync)
  await detectIndustry(session, lower, userMessage);
  updateHeatScore(session, lower);

  // logga användarens meddelande
  await logChatMessage(sessionId, "user", userMessage, session);

  // ========================================================
  //  PERSONLIG SMALLTALK / IDENTITET
  // ========================================================
  if (/^(hej|hejsan|tja|tjena|hello|hallå)$/i.test(userMessage)) {
    const reply =
      "Hej! Jag är Zenvia Worlds digitala assistent. Berätta gärna kort vad du vill få hjälp med – allt från AI-chattbotar till hemsidor och automation.";
    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (lower.includes("hur mår du")) {
    const reply =
      "Jag mår bra – jag är alltid igång och redo att hjälpa dig med Zenvia-relaterade frågor.";
    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (lower.includes("vad heter du")) {
    const reply = "Jag heter Zenvia AI Assistant och fungerar som en digital rådgivare för Zenvia World.";
    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (lower.includes("hur gammal är du")) {
    const reply =
      "Jag har ingen ålder som en människa – jag är en digital assistent skapad för att hjälpa företag med AI, hemsidor och automation.";
    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (lower.includes("är du en riktig person") || lower.includes("är du en människa")) {
    const reply =
      "Jag är inte en människa utan en AI-assistent, tränad för att hjälpa dig med frågor kring Zenvia World och digital tillväxt.";
    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (lower.includes("vad gör du") || lower.includes("vad jobbar du med")) {
    const reply =
      "Jag hjälper dig förstå vad Zenvia kan göra för ditt företag – allt från AI-chattbotar och hemsidor till automation och smartare kundflöden.";
    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  // ========================================================
  //  ZENVIA-FAKTA – ENBART FRÅN KNOWLEDGE BASE
  // ========================================================
  if (
    lower.includes("när grundades zenvia") ||
    lower.includes("vilket år grundades zenvia")
  ) {
    const reply = "Zenvia World grundades 2025 i Göteborg, Sverige.";
    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (
    lower.includes("var grundades zenvia") ||
    lower.includes("vart grundades zenvia") ||
    lower.includes("var ligger zenvia") ||
    lower.includes("vart ligger zenvia")
  ) {
    const reply = "Zenvia World har sin grund i Sverige, med start i Göteborg.";
    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (lower.includes("vad är zenvia") || lower.includes("vad gör zenvia")) {
    const reply =
      "Zenvia World hjälper företag växa genom AI-chattbotar, moderna hemsidor, automation och smarta affärssystem som skapar tydligare kundflöden och mindre manuellt arbete.";
    // ingen CTA här – neutral info
    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  // ========================================================
  //  PRIS – ALLTID TILL KONSULTATION, MED CTA
  // ========================================================
  if (
    lower.includes("pris") ||
    lower.includes("kostnad") ||
    lower.includes("kosta") ||
    lower.includes("budget")
  ) {
    let reply = `
Priset beror helt på omfattning och vilka mål ni har. Vi börjar alltid med att förstå nuläge och behov, och därefter rekommenderar vi en lösning som är rimlig och lönsam.
Ofta är bästa första steg att boka en kort konsultation där vi går igenom det tillsammans.
    `.trim();

    reply = maybeAttachBookingToken(
      reply + "\n\nBoka gärna en konsultation så får du en tydlig bild av kostnad och upplägg.",
      session
    );

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  // ========================================================
  //  DIREKTA BEHOV – CHATTBOT, HEMSIDA, AUTOMATION, M.M.
  //  → Stil B + boknings-CTA (med cooldown)
// ========================================================
  if (lower.includes("chattbot") || lower.includes("chatbot")) {
    let reply = `
Absolut, en chattbot kan göra stor skillnad för både tydlighet och kundflöde på din hemsida. Vi bygger AI-chattbotar som guidar besökare, svarar automatiskt och fångar fler förfrågningar.
Vi hjälper dig sätta upp allt – boka gärna en konsultation så tar vi nästa steg.
    `.trim();

    reply = maybeAttachBookingToken(reply, session);

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (
    lower.includes("hemsida") ||
    lower.includes("webbsida") ||
    lower.includes("webbplats") ||
    lower.includes("webbplats")
  ) {
    let reply = `
En modern, tydlig hemsida kombinerad med rätt automation gör att fler besökare faktiskt blir kunder. Vi hjälper till med både struktur, design och AI-funktioner som lyfter kundresan.
Vill du ta nästa steg är en konsultation ett smidigt sätt att komma igång.
    `.trim();

    reply = maybeAttachBookingToken(reply, session);

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (
    lower.includes("automatisera") ||
    lower.includes("automation") ||
    lower.includes("automatisering")
  ) {
    let reply = `
Automation kan ta bort mycket manuellt arbete och göra flöden mer förutsägbara. Vi hjälper företag bygga smarta system för bokningar, kundkontakt och uppföljning.
En konsultation är ett bra första steg för att se vad som ger mest effekt hos er.
    `.trim();

    reply = maybeAttachBookingToken(reply, session);

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  // ========================================================
  //  DIREKT BOKNING / MÖTE
  // ========================================================
  if (
    lower.includes("boka") ||
    lower.includes("konsultation") ||
    lower.includes("möte") ||
    lower.includes("samtal")
  ) {
    let reply = `
Perfekt – då är nästa steg att boka en konsultation. Där går vi igenom din situation, vad du vill uppnå och vilka lösningar som passar bäst.
    `.trim();

    reply = maybeAttachBookingToken(
      reply + "\n\nBoka gärna en tid som passar dig så tar vi det därifrån.",
      session
    );

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  // ========================================================
  //  HETA LEADS / KÖPSIGNALER
  // ========================================================
  if (
    lower.includes("komma igång") ||
    lower.includes("hur börjar vi") ||
    lower.includes("hur kommer vi igång") ||
    lower.includes("vi behöver hjälp") ||
    lower.includes("vi vill ha hjälp") ||
    lower.includes("jag vill ha hjälp") ||
    lower.includes("vill jobba med er")
  ) {
    let reply = `
Det låter som att ni är redo att ta nästa steg. Då är en kort konsultation det bästa sättet att snabbt få en tydlig plan och komma igång utan onödigt krångel.
    `.trim();

    reply = maybeAttachBookingToken(
      reply + "\n\nBoka gärna en konsultation så sätter vi ramarna tillsammans.",
      session
    );

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  // ========================================================
  //  INTENT-BASERAT (FRÅN FRONTEND-KNAPPAR)
// ========================================================
  if (intent === "fler kunder") {
    let reply = `
Fler kunder handlar ofta om bättre synlighet och en kundresa som faktiskt fungerar hela vägen. Vi hjälper företag skapa system som gör att fler hör av sig och blir riktiga affärer.
En konsultation är ett bra sätt att se vad som skulle ge störst effekt hos er.
    `.trim();

    reply = maybeAttachBookingToken(reply, session);

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (intent === "hemsida") {
    let reply = `
En proffsig hemsida med tydlig struktur och rätt AI-funktioner gör stor skillnad för hur många som faktiskt tar kontakt. Vi kan hjälpa dig uppgradera eller bygga nytt från grunden.
Vill du gå vidare är konsultation nästa naturliga steg.
    `.trim();

    reply = maybeAttachBookingToken(reply, session);

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (intent === "automation") {
    let reply = `
Automation gör att ni kan lägga mer tid på kärnverksamheten och mindre på manuella moment. Vi bygger flöden för bokningar, leads, uppföljning och mer.
En konsultation hjälper oss ringa in vad som skulle göra mest skillnad hos er.
    `.trim();

    reply = maybeAttachBookingToken(reply, session);

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (intent === "annonsering") {
    let reply = `
AI-stödd annonsering fungerar som bäst när hemsida, erbjudande och uppföljning hänger ihop. Vi hjälper till att skapa ett flöde där fler leads faktiskt blir kunder.
Känns det intressant är en konsultation ett bra första steg.
    `.trim();

    reply = maybeAttachBookingToken(reply, session);

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (intent === "konsultation") {
    let reply = `
Toppen – konsultationen är bästa sättet att snabbt få en tydlig bild av vad vi kan göra för ditt företag och vilka steg som är mest rimliga att ta först.
    `.trim();

    reply = maybeAttachBookingToken(
      reply + "\n\nVälj en tid som passar dig så tar vi det därifrån.",
      session
    );

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  if (intent === "oklart") {
    const reply = `
Inga problem – du behöver inte ha en färdig plan. Berätta gärna kort vad du driver eller vill göra, så kan jag ge förslag på hur Zenvia skulle kunna hjälpa till.
    `.trim();

    await logChatMessage(sessionId, "assistant", reply, session);
    return res.json({ reply });
  }

  // ========================================================
  //  DEFAULT – LLM SVAR MED NEUTRAL TONE & ZENVIA-KB
  //  (INGEN TOKEN HÄR; CTA sköts av ovan regler)
// ========================================================
  const systemBehavior = buildSystemPrompt(session);

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemBehavior },
      { role: "user", content: userMessage }
    ],
    max_tokens: 220,
    temperature: 0.4
  });

  let reply = completion.choices[0].message.content || "Jag kunde inte tolka din fråga riktigt, men du får gärna formulera om den.";

  // ingen automatisk BOOKING_TOKEN här – allt CTA-styrt ligger i reglerna ovan

  await logChatMessage(sessionId, "assistant", reply, session);
  return res.json({ reply });
});

// ============================================================
//  SERVER START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Zenvia World AI körs på port ${PORT}`);
});
