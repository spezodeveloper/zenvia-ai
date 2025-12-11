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
const sessions = {}; // { [sessionId]: { intent, industry } }

function getSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      intent: null,
      industry: null
    };
  }
  return sessions[sessionId];
}

app.post("/chat", async (req, res) => {
  const userMessageRaw = req.body.message || "";
  const userMessage = userMessageRaw.trim();

  const sessionId = req.body.sessionId || "default-session";
  const intent = req.body.intent || null;

  const session = getSession(sessionId);
  if (intent) session.intent = intent;

  const lower = userMessage.toLowerCase();

  const BOOKING_TOKEN = "{{BOOK_CALL}}";

  /* ============================================================
     BRANSCH-DETEKTION (HYBRID)
============================================================ */
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

  const safeLower = ` ${lower} `;
  let detectedIndustry = null;

  for (const [industry, words] of Object.entries(industryMap)) {
    if (words.some(w => safeLower.includes(w))) {
      detectedIndustry = industry;
      break;
    }
  }

  async function validateIndustry(industryGuess, message) {
    if (!industryGuess) return null;

    const check = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "Svara endast ja eller nej, extremt strikt." },
        {
          role: "user",
          content: `Text: "${message}"\nBranschgissning: ${industryGuess}\nÄr detta korrekt?`
        }
      ],
      max_tokens: 1,
      temperature: 0
    });

    const ans = check.choices[0].message.content.trim().toLowerCase();
    return ans === "ja" ? industryGuess : null;
  }

  if (!session.industry && detectedIndustry) {
    session.industry = await validateIndustry(detectedIndustry, userMessage);
  }

  /* ============================================================
     SYSTEM PROMPT – BOOKING CLOSER
============================================================ */
  const systemBehavior = `
Du är Zenvia Worlds digitala assistent.

Ditt mål är att hjälpa användaren, förstå deras behov och naturligt leda vidare till en konsultation – 
MEN du ska bara lägga till bokningstoken {{BOOK_CALL}} när användaren visar tydligt intresse eller
säger något som antyder att Zenvia kan hjälpa dem.

Tonalitet:
- Modern, kort, trygg, professionell.
- Ge max 1–2 meningar per svar.

REGLER:

1. När användaren berättar om sitt företag, sin bransch eller sin situation:
   - Svara normalt, ställ en naturlig följdfråga.
   - INGEN bokningstoken här.

2. När användaren uttrycker ett problem Zenvia kan lösa (t.ex. chattbot, hemsida, automation):
   - Bekräfta
   - Förklara kort att Zenvia löser detta
   - FRÅGA något litet för kontext
   - INGEN token än.

3. När användaren visar tydligt intresse eller köpsignal (t.ex. “kan ni göra det”, “låter bra”, “vill ha hjälp”, “hur kommer man igång”):
   - Bekräfta kort
   - Förklara att konsultation är nästa steg
   - AVSLUTA svaret med {{BOOK_CALL}}.

4. När användaren ber om pris:
   - Förklara att pris beror på omfattning
   - Berätta att konsultation ger tydlighet
   - Lägg till {{BOOK_CALL}}.

5. När användaren skriver att de vill boka eller gå vidare:
   - Bekräfta
   - Skicka {{BOOK_CALL}} direkt.

Du ska INTE lägga {{BOOK_CALL}} på neutrala meddelanden eller när användaren bara berättar något.
Du ska ENDAST inkludera {{BOOK_CALL}} när det är logiskt att boka.

Om användaren ställer en neutral faktabaserad fråga (t.ex. om Zenvias historia, årtal, grundare, namn, vision,
beskrivningar eller liknande):
- Svara kort och sakligt.
- Ingen försäljning.
- Ingen bokningsrekommendation.
- Ingen {{BOOK_CALL}}.

MEN om faktan är kopplad till ett behov (t.ex. "vad gör ni" → potentiellt behov):
- Svara kort.
- Om det låter som att användaren söker hjälp, först då föreslå konsultation och lägga {{BOOK_CALL}}.

Du ska ALDRIG tvinga in bokningstoken när frågan inte handlar om behov eller tjänster.


  `;

  /* ============================================================
     HÄLSNING
============================================================ */
  if (/^(hej|hejsan|tja|tjena|hello|hallå)$/i.test(userMessage)) {
    return res.json({
      reply: `Hej! Berätta kort vad du vill få hjälp med, så ser vi till att du bokar en konsultation som passar dig.\n\n${BOOKING_TOKEN}`
    });
  }

  /* ============================================================
     PRIS
============================================================ */
  if (
    lower.includes("pris") || lower.includes("kostnad") ||
    lower.includes("budget") || lower.includes("kosta")
  ) {
    return res.json({
      reply: `
Priset beror på omfattning och vilken effekt ni vill uppnå, så vi går alltid igenom behovet först. 
En kort konsultation ger en tydlig rekommendation och en uppskattning.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  /* ============================================================
     DIREKTA INTENT – CHATTBOT, HEMSIDA, BOKNING
============================================================ */

  // Chattbot
  if (lower.includes("chattbot") || lower.includes("chatbot")) {
    return res.json({
      reply: `
Vi bygger AI-chattbotar som guidar besökare, svarar automatiskt och ökar både tydlighet och konvertering. 
Berätta gärna lite om ditt företag – men enklast är att boka en konsultation så går vi igenom exakt vad ni behöver.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  // Hemsida
  if (lower.includes("hemsida") || lower.includes("webb") || lower.includes("webbsida")) {
    return res.json({
      reply: `
En modern, professionell hemsida + rätt automation gör att fler besökare blir riktiga kunder. 
Vi skapar helhetslösningar som lyfter både struktur, design och kundresa. 
Boka gärna en konsultation så tittar vi konkret på vad som passar dig.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  // Bokning / konsultation
  if (
    lower.includes("boka") || lower.includes("konsultation") ||
    lower.includes("möte") || lower.includes("samtal")
  ) {
    return res.json({
      reply: `
Perfekt – då är nästa steg att boka en tid. 
Vi går igenom din situation och visar exakt hur vi kan hjälpa dig snabbt och effektivt.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  /* ============================================================
     INTENT-BASERAT FRÅN KNAPPAR – CTA VERSION
============================================================ */
  if (intent === "fler kunder") {
    return res.json({
      reply: `
Fler kunder handlar om rätt synlighet och en kundresa som faktiskt fungerar. 
Vi hjälper företag skapa system som gör att fler hör av sig – och konverterar bättre. 
Boka gärna en konsultation så visar vi vad som passar just er.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (intent === "hemsida") {
    return res.json({
      reply: `
En proffsig hemsida med rätt AI-funktioner gör stor skillnad för hur många som faktiskt tar kontakt. 
Låt oss gå igenom din struktur och skapa något som fungerar bättre – steg ett är en konsultation.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (intent === "automation") {
    return res.json({
      reply: `
Automation och smarta flöden gör verksamheten både snabbare och enklare. 
Vi hjälper dig bygga system som sparar tid och ökar kvaliteten – börja med en kort konsultation.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (intent === "annonsering") {
    return res.json({
      reply: `
AI-optimerad annonsering ger fler rätt kunder till lägre kostnad när helheten sitter ihop. 
I en konsultation går vi igenom nuläget och ser vad som ger er snabbast effekt.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (intent === "konsultation") {
    return res.json({
      reply: `
Toppen – konsultationen är bästa sättet att snabbt komma vidare. 
Välj en tid som passar dig så tar vi det därifrån.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (intent === "oklart") {
    return res.json({
      reply: `
Ingen stress – du behöver inte ha en plan än. 
Berätta kort vad du driver eller vill göra, så tar vi nästa steg i en konsultation.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  /* ============================================================
     SPESIELLA STATEMENTS (“vad gör ni”, “liten budget”, osv)
============================================================ */

  if (lower.includes("vad gör ni") || lower.includes("vad är zenvia")) {
    return res.json({
      reply: `
Zenvia World bygger moderna hemsidor, AI-chattbotar, automation och smarta system som hjälper företag växa snabbare med mindre arbete. 
Vill du se vad vi kan göra för dig – boka gärna en konsultation.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (lower.includes("liten budget")) {
    return res.json({
      reply: `
Vi kan anpassa lösningar efter olika nivåer så länge fokus ligger på tydlig effekt. 
En konsultation gör att vi snabbt ser vad som är mest lönsamt att börja med.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (lower.includes("jämför")) {
    return res.json({
      reply: `
Det viktigaste är att ni får en partner som kan både affär och teknik. 
Vi fokuserar på system som ger mätbara resultat – vill du se hur det skulle kunna se ut för er, boka gärna en konsultation.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (lower.includes("växa snabbt")) {
    return res.json({
      reply: `
Snabb tillväxt kräver struktur, synlighet och smarta flöden. 
Vi hjälper företag bygga detta från grunden – börja med en kort konsultation.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (lower.includes("starta företag")) {
    return res.json({
      reply: `
Vi hjälper dig sätta en digital grund som är redo att växa direkt – hemsida, struktur, automation och tydlig kundresa. 
Boka gärna en konsultation så kan vi forma något efter dina planer.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  if (lower.includes("bara nyfiken")) {
    return res.json({
      reply: `
Du får gärna vara nyfiken – vi visar gärna vad som är möjligt. 
En konsultation är bästa sättet att få en konkret bild av vad AI och digital struktur kan göra för dig.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  /* ============================================================
     HETA LEADS – MAX CTA
============================================================ */
  if (
    lower.includes("komma igång") ||
    lower.includes("vi behöver hjälp") ||
    lower.includes("vill jobba med er") ||
    lower.includes("hur börjar vi")
  ) {
    return res.json({
      reply: `
Perfekt – då är konsultationen helt rätt nästa steg. 
Där går vi igenom nuläge, behov och vad vi kan sätta igång med direkt.

${BOOKING_TOKEN}
      `.trim()
    });
  }

  /* ============================================================
     DEFAULT – LÅT LLM GENERERA MEN STYR TILL BOKNING
============================================================ */
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemBehavior },
      { role: "user", content: userMessage }
    ],
    max_tokens: 220,
    temperature: 0.4
  });

  return res.json({
    reply: completion.choices[0].message.content
  });
});

/* ============================================================
   SERVER
============================================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Zenvia AI Booking running on port ${PORT}`));

