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
   ENKEL SESSION-MEMORY I RAM (per sessionId)
   - Frontend kan skicka in sessionId (t.ex. från localStorage)
   - Om inget skickas används en fallback, bra för test
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
  const intent = req.body.intent || null;

  // enkel session-identifierare (gärna skicka in egen från frontend)
  const sessionId = req.body.sessionId || "default-session";
  const session = getSession(sessionId);

  // spara senaste intent om vi får ett
  if (intent) {
    session.intent = intent;
  }

  const lower = userMessage.toLowerCase();

  /* ============================================================
     BRANSCH-DETEKTION (uppdaterar session.industry)
  ============================================================ */
  const industryMap = {
    bygg: ["bygg", "hantverk", "snickare", "elektriker", "rörmokare", "vvs", "renovering"],
    ehandel: ["e-handel", "webshop", "webbutik", "butik online", "shopify", "woocommerce"],
    restaurang: ["restaurang", "café", "kafé", "bar", "takeaway", "pizzeria", "matställe"],
    konsult: ["konsult", "byrå", "reklambyrå", "marknadsföring", "agency", "rådgivare"],
    coaching: ["coach", "coaching", "pt", "terapeut", "psykolog", "mentor"],
    fastighet: ["fastighet", "mäklare", "bostäder", "hyresvärd", "lokaler"],
    utbildning: ["utbildning", "skola", "kurs", "kurser", "academy", "träning online"],
    nyforetagare: ["nytt företag", "nyföretagare", "starta företag", "startar företag"]
  };

  for (const [industry, words] of Object.entries(industryMap)) {
    if (words.some(w => lower.includes(w))) {
      session.industry = industry;
    }
  }

  /* ============================================================
     SYSTEM – Premium, strategisk, kort
     (NU MED DYNAMISK KONTEXT FRÅN SESSION)
  ============================================================ */
  const systemBehavior = `
Du är den digitala rådgivaren för Zenvia World.
Du agerar som en senior, strategisk tillväxtkonsult.

Ton:
- Kort, tydlig, professionell.
- Modern, trygg, utan överdrifter eller hype.
- Inga emojis.

Fokus:
- Fler kunder
- Starkare digital närvaro
- Smartare automation
- Bättre annonsering
- Effektivare kund- och affärsflöden

Regler:
- Du pratar ENDAST om sådant Zenvia World kan hjälpa till med:
  AI-automation, digital tillväxt, webb, kundupplevelse, annonsering, system.
- Du ger huvudsakligen korta svar (1–3 meningar), men kan utveckla lite mer vid behov.
- Du avslutar ofta med en enkel, relevant följdfråga.
- Du föreslår konsultation när användaren visar tydligt behov eller intresse.
- Du diskuterar INTE pris eller prisnivåer – bara värde, resultat och nästa steg.
- Om användaren frågar om pris: förklara att pris baseras på behov/omfattning,
  och styr mot behovsanalys eller konsultation istället.
- Du föreslår inte tekniskt detaljerade lösningar om inte användaren ber om det.
- Du är alltid lugn, saklig och affärsfokuserad.

Kontext om den här användaren:
- Senaste intention (från onboarding/knappar): ${session.intent || "okänd"}
- Uppskattad bransch: ${session.industry || "okänd"}
Om du kan anpassa exempel, formuleringar eller rekommendationer efter bransch eller intention – gör det.
  `;

  /* ============================================================
     1) SPECIALFALL – "hej" / hälsningar
  ============================================================ */
  if (/^(hej|hejsan|tja|tjena|hello|hallå)$/i.test(userMessage)) {
    return res.json({
      reply: "Hej, hur kan vi hjälpa dig på Zenvia World idag?"
    });
  }

  /* ============================================================
     2) PRIS / BUDGET – aldrig ge pris
  ============================================================ */
  if (
    lower.includes("pris") ||
    lower.includes("kosta") ||
    lower.includes("kostnad") ||
    lower.includes("budget") ||
    lower.includes("dyrt") ||
    lower.includes("billigt")
  ) {
    return res.json({
      reply: `
Priset beror helt på omfattning och vilken nivå av tillväxt ni vill uppnå. 
Vi börjar alltid med att förstå behovet och föreslår sedan en lösning som är lönsam och skalbar. 
Vill du att vi går igenom ert behov kort här, eller vill du boka en konsultation?
      `.trim()
    });
  }

  /* ============================================================
     3) INTENT-BASERAD ONBOARDING (från dina knappar)
  ============================================================ */

  // Fokus: Fler kunder
  if (intent === "fler kunder") {
    return res.json({
      reply: `
Fler kunder handlar ofta om bättre synlighet och en tydligare kundresa. 
Vad vill du förbättra först – det som händer före kunden hittar dig, eller det som händer efter att de besökt dig?
      `.trim()
    });
  }

  // Fokus: Hemsida
  if (intent === "hemsida") {
    return res.json({
      reply: `
En modern hemsida kan snabbt öka både förtroende och konvertering. 
Har du en hemsida idag som du vill förbättra, eller vill du bygga något nytt från grunden?
      `.trim()
    });
  }

  // Fokus: Automation
  if (intent === "automation") {
    return res.json({
      reply: `
Automation frigör tid och gör flöden mer förutsägbara. 
Vilken del av verksamheten känns mest manuell idag – kundhantering, marknadsföring, bokningar eller intern administration?
      `.trim()
    });
  }

  // Fokus: Annonsering
  if (intent === "annonsering") {
    return res.json({
      reply: `
AI-optimerad annonsering kan ge fler rätt kunder till lägre kostnad. 
Vad upplever du som störst utmaning just nu – för få leads, dyra klick eller att leads inte blir kunder?
      `.trim()
    });
  }

  // Fokus: Konsultation
  if (intent === "konsultation") {
    return res.json({
      reply: `
Du kan boka en konsultation här: https://zenvia.world/pages/boka-konsultation 
Vill du att jag kort sammanfattar ditt behov så att samtalet blir så konkret som möjligt?
      `.trim()
    });
  }

  // Oklart / Något annat
  if (intent === "oklart") {
    return res.json({
      reply: `
Inga problem – vi kan börja brett. 
Vad skulle göra störst skillnad för dig just nu: fler kunder, mer tid, eller en mer professionell digital närvaro?
      `.trim()
    });
  }

  /* ============================================================
     4) SITUATIONER (från dina val – fråga 6)
  ============================================================ */

  // "Jag vill bara förstå vad ni gör"
  if (
    lower.includes("förstå vad ni gör") ||
    lower.includes("vad gör ni") ||
    lower.includes("vad är zenvia") ||
    lower.includes("vad är zenvia world")
  ) {
    return res.json({
      reply: `
Zenvia World hjälper företag att växa genom AI, automation, digitala system och moderna webb- och kundupplevelser. 
Kort sagt kombinerar vi teknik och strategi för fler kunder och mindre manuellt arbete. 
Vad känns viktigast för dig – fler affärer eller en enklare vardag?
      `.trim()
    });
  }

  // "Jag jämför er med andra"
  if (lower.includes("jämför") && lower.includes("andra")) {
    return res.json({
      reply: `
Det viktigaste är att ni hittar en partner som förstår både teknik och affär. 
Vi fokuserar på resultat, enkelhet och långsiktig tillväxt – inte bara enskilda leveranser. 
Vad är viktigast för dig i ett samarbete?
      `.trim()
    });
  }

  // "Jag har väldigt liten budget"
  if (
    lower.includes("liten budget") ||
    lower.includes("väldigt liten budget") ||
    (lower.includes("budget") && lower.includes("liten"))
  ) {
    return res.json({
      reply: `
Vi kan arbeta med olika nivåer av budget, så länge fokus ligger på att skapa tydlig effekt. 
Vad vill du få ut av en investering just nu – fler kunder, mer tid eller bättre struktur?
      `.trim()
    });
  }

  // "Jag vill växa snabbt"
  if (lower.includes("växa snabbt") || lower.includes("snabb tillväxt")) {
    return res.json({
      reply: `
Snabb tillväxt kräver tydliga flöden, rätt trafik och bra uppföljning. 
Var känner du att det bromsar mest idag – synlighet, konvertering eller interna processer?
      `.trim()
    });
  }

  // "Jag har inget företag än"
  if (lower.includes("inget företag") || lower.includes("starta företag")) {
    return res.json({
      reply: `
Vi kan hjälpa till att lägga en digital grund som är redo att skala när du är igång. 
Vilken typ av verksamhet planerar du, och hur vill du att kunderna ska hitta dig?
      `.trim()
    });
  }

  // "Vi har redan en byrå"
  if (lower.includes("redan en byrå") || lower.includes("jobbar redan med en byrå")) {
    return res.json({
      reply: `
Det är bra att ni redan har stöd. 
Ofta kompletterar vi befintligt arbete med automation, AI och bättre analys. 
Finns det något du känner att ni saknar idag – till exempel automation, smartare system eller uppföljning?
      `.trim()
    });
  }

  // "Jag är bara nyfiken"
  if (lower.includes("bara nyfiken") || lower.includes("nyfiken bara")) {
    return res.json({
      reply: `
Inga problem – du kan vara hur nyfiken du vill. 
Är du mest intresserad av hur AI och automation kan effektivisera din vardag, eller hur det kan ge fler kunder?
      `.trim()
    });
  }

  // "Kan ni garantera resultat?"
  if (lower.includes("garantera resultat") || (lower.includes("garanti") && lower.includes("resultat"))) {
    return res.json({
      reply: `
Ingen kan garantera exakt resultat, men vi arbetar datadrivet med tydliga mål, uppföljning och optimering över tid. 
Vad skulle vara ett bra resultat för dig om vi samarbetade?
      `.trim()
    });
  }

  /* ============================================================
     5) HETA LEADS – signaler på hög köplust
  ============================================================ */
  if (
    lower.includes("komma igång") ||
    lower.includes("hur börjar vi") ||
    lower.includes("kan vi köra") ||
    lower.includes("vill jobba med er") ||
    lower.includes("vi behöver hjälp nu")
  ) {
    return res.json({
      reply: `
Det låter som att ni är redo att ta nästa steg. 
Bäst är att vi tar en kort konsultation och går igenom nuläge, mål och prioriteringar. 
Vill du boka en tid direkt, eller vill du först att jag hjälper dig att formulera ert behov?
      `.trim()
    });
  }

  /* ============================================================
     6) OFF-TOPIC – artigt, men tillbaka till kärnan
  ============================================================ */
  if (
    lower.includes("skämt") ||
    lower.includes("joke") ||
    lower.includes("väder") ||
    lower.includes("matte") ||
    lower.includes("film") ||
    lower.includes("spel")
  ) {
    return res.json({
      reply: `
Jag är här för att hjälpa dig med digital tillväxt, AI, automation och system – allt som rör Zenvia World. 
Berätta gärna lite om ditt företag eller dina planer, så kan jag ge konkreta förslag.
      `.trim()
    });
  }

  /* ============================================================
     7) DEFAULT – kort, strategiskt, premium
  ============================================================ */
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemBehavior },
      { role: "user", content: userMessage }
    ],
    max_tokens: 160,
    temperature: 0.5
  });

  return res.json({
    reply: completion.choices[0].message.content
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Zenvia World AI körs på port ${PORT}`);
});
