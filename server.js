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
   ZENVIA FACTS (ENDAST HÄRIFRÅN – INTE INTERNET)
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
   CLASSIFIER – ZEN-INTENT V2
============================================================ */
async function classifyMessage(message) {
  const prompt = `
Klassificera följande meddelande i EN kategori:

"${message}"

Kategorier:
- smalltalk (vardagligt prat, hur mår du, vad gör du, vad heter du, haha, wow, nice, lol, hype)
- compliment (beröm, uppskattning, positiv reaktion, "sjukt bra", "fett bra", "imponerande" osv)
- insult (förolämpning / otrevligt)
- neutral_fact (fråga om Zenvias fakta: årtal, grundare, vision, plats, team, info)
- business_need (användaren uttrycker ett behov Zenvia kan lösa: hemsida, annonser, Google Ads, Meta Ads, automation, chattbot, system)
- cta_trigger (användaren visar tydlig köpsignal: "kan ni fixa det", "hur börjar vi", "kan vi köra", "vill ha hjälp", "vill boka")
- irrelevant (nonsens, spam, något som inte går att tolka)

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
   SERVICE DETECTION (för snyggare svar)
============================================================ */
function detectServiceType(lower) {
  if (lower.includes("google ads") || lower.includes("sökordsannons") || lower.includes("google reklam")) {
    return "google_ads";
  }
  if (
    lower.includes("meta ads") ||
    lower.includes("facebook ads") ||
    (lower.includes("facebook") && lower.includes("annons")) ||
    (lower.includes("instagram") && lower.includes("annons"))
  ) {
    return "meta_ads";
  }
  if (
    lower.includes("hemsida") ||
    lower.includes("webbsida") ||
    lower.includes("webbplats") ||
    lower.includes("sida till mitt företag")
  ) {
    return "website";
  }
  if (lower.includes("chattbot") || lower.includes("chatbot")) {
    return "chatbot";
  }
  if (lower.includes("automation") || lower.includes("automatisera") || lower.includes("flöden")) {
    return "automation";
  }
  if (lower.includes("crm") || lower.includes("kundsystem") || lower.includes("kundresa")) {
    return "crm";
  }
  return null;
}

/* ============================================================
   HELPERS FÖR SVAR + CTA
============================================================ */
function send(res, text) {
  return res.json({ reply: text });
}

function sendCTA(res, text) {
  return res.json({ reply: `${text}\n\n{{BOOK_CALL}}` });
}

function respondWithCTA(res, session, baseText) {
  if (session.ctaCooldown > 0) {
    session.ctaCooldown = Math.max(session.ctaCooldown - 1, 0);
    return send(res, baseText);
  }
  session.ctaCooldown = 3;
  return sendCTA(res, baseText);
}

/* ============================================================
   MAIN CHAT ENDPOINT
============================================================ */
app.post("/chat", async (req, res) => {
  const userMessageRaw = req.body.message || "";
  const userMessage = userMessageRaw.trim();
  const lower = userMessage.toLowerCase();

  const sessionId = req.body.sessionId || "default";
  const session = getSession(sessionId);

  // Safety: tomt meddelande
  if (!userMessage) {
    return send(res, "Skriv gärna några ord så kan jag hjälpa dig vidare.");
  }

  // 1) Klassificera
  const intent = await classifyMessage(userMessage);
  // console.log("INTENT:", intent, "MSG:", userMessage);

  /* ============================================================
     SMALLTALK
  ============================================================ */
  if (intent === "smalltalk") {
    // Specifika frågor: namn / hur mår du
    if (lower.includes("vad heter du")) {
      return send(res, "Jag heter Zenvia AI Assistant – jag är här för att guida dig genom allt vi kan göra digitalt.");
    }
    if (lower.includes("hur mår du") || lower.includes("hur är läget") || lower.includes("how are you")) {
      return send(res, "Jag mår alltid bra – jag är igång dygnet runt och redo att hjälpa dig med det du vill utforska.");
    }

    return send(res, "Jag är Zenvias AI-assistent – vad är du nyfiken på eller vad vill du förbättra just nu?");
  }

  /* ============================================================
     COMPLIMENT
  ============================================================ */
  if (intent === "compliment") {
    return send(res, "Tack, det uppskattas. Säg bara till om du vill testa något eller har frågor.");
  }

  /* ============================================================
     INSULT
  ============================================================ */
  if (intent === "insult") {
    return send(res, "Jag tar inget personligt – jag är här för att hjälpa dig. Vad vill du få ut av Zenvia eller din digitala närvaro?");
  }

  /* ============================================================
     NEUTRAL FACT (om Zenvia)
  ============================================================ */
  if (intent === "neutral_fact") {
    return send(res, ZENVIA_FACTS);
  }

  /* ============================================================
     BUSINESS NEED (behöver hjälp med något vi gör)
     – Alternativ B: först följdfråga, sen CTA
  ============================================================ */
  if (intent === "business_need") {
    const service = detectServiceType(lower);

    // Första gången: förtydliga + följdfråga
    if (!session.hasPendingNeed) {
      session.hasPendingNeed = true;

      // Service-specifika svar
      if (service === "google_ads") {
        return send(
          res,
          "Absolut — vi jobbar dagligen med Google Ads för att ge företag fler relevanta kunder. Vad är ditt mål med annonseringen just nu?"
        );
      }

      if (service === "meta_ads") {
        return send(
          res,
          "Ja, vi hjälper företag med Meta Ads (Facebook/Instagram) för att driva fler bokningar och förfrågningar. Vad vill du framför allt uppnå med annonseringen?"
        );
      }

      if (service === "website") {
        return send(
          res,
          "Det kan vi – vi bygger moderna, konverterande hemsidor som känns professionella och tydliga. Vad vill du att en ny hemsida ska lösa för dig?"
        );
      }

      if (service === "chatbot") {
        return send(
          res,
          "Vi bygger AI-chattbotar som guidar kunder, svarar automatiskt och lyfter tydlighet på sidan. Vad vill du att en chattbot ska hjälpa dina besökare med?"
        );
      }

      if (service === "automation") {
        return send(
          res,
          "Vi sätter upp automationer som tar bort manuellt arbete i bokningar, kundflöden och uppföljning. Vilken del av din verksamhet känns mest manuell idag?"
        );
      }

      // Generellt business-behov
      return send(
        res,
        "Det låter som något vi kan hjälpa dig med. Berätta lite kort om ditt företag och vad du vill uppnå, så guidar jag dig rätt."
      );
    }

    // Andra gången det kommer business_need när hasPendingNeed = true
    // → eskalera till CTA (med cooldown)
    session.hasPendingNeed = false;

    const service = detectServiceType(lower);
    let baseText;

    if (service === "google_ads") {
      baseText =
        "Grymt – med Google Ads kan vi driva in fler relevanta förfrågningar direkt till ditt företag. En kort konsultation gör att vi kan sätta en konkret plan för er.";
    } else if (service === "meta_ads") {
      baseText =
        "Perfekt – Meta Ads funkar riktigt bra för lokala tjänster och varumärkesbyggande. I en konsultation går vi igenom målgrupp, erbjudande och hur vi får fler bokningar.";
    } else if (service === "website") {
      baseText =
        "En genomtänkt hemsida kan göra stor skillnad för hur många som faktiskt hör av sig. I en konsultation tittar vi på nuläget och vad som krävs för att lyfta både känsla och struktur.";
    } else if (service === "chatbot") {
      baseText =
        "En AI-chattbot kan göra sidan mycket tydligare för kunder och ta hand om frågor automatiskt. I en konsultation ritar vi upp vad den ska göra och hur den kopplas in.";
    } else {
      baseText =
        "Det låter som att vi verkligen kan hjälpa er att ta nästa steg. En kort konsultation är bästa sättet att få en konkret plan istället för lösa idéer.";
    }

    return respondWithCTA(res, session, baseText);
  }

  /* ============================================================
     CTA TRIGGER – användaren visar tydlig köpsignal
  ============================================================ */
  if (intent === "cta_trigger") {
    session.hasPendingNeed = false; // vi är redan på CTA-läget

    const baseText =
      "Toppen — då är nästa steg att boka en konsultation, så går vi igenom läge, mål och vad vi kan sätta igång med direkt.";

    return respondWithCTA(res, session, baseText);
  }

  /* ============================================================
     IRRELEVANT / FALLBACK
  ============================================================ */
  if (intent === "irrelevant") {
    return send(
      res,
      "Jag är fokuserad på att hjälpa till med AI, digital närvaro, annonsering, automation och liknande. Berätta gärna lite om ditt företag eller vad du vill förbättra."
    );
  }

  // Om något oväntat händer
  return send(res, "Jag är här och redo att hjälpa – berätta gärna lite mer så tar vi det därifrån.");
});

/* ============================================================
   START SERVER
============================================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Zenvia AI v3 server running on port ${PORT}`);
});
