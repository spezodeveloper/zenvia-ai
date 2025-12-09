import express from "express";
import OpenAI from "openai";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/chat", async (req, res) => {
  const userMessageRaw = req.body.message || "";
  const userMessage = userMessageRaw.trim();
  const intent = req.body.intent || null;
  const lower = userMessage.toLowerCase();

  /* ============================================================
     SYSTEM – Premium, strategisk, kort
  ============================================================ */
  const systemBehavior = `
Du är den digitala rådgivaren för Zenvia World.
Du agerar som en senior, strategisk tillväxtkonsult.

Ton:
- Kort, tydlig, professionell.
- Minimal text, inga emojis.
- Strategisk, affärsfokuserad, trygg.
- Aldrig pushig, alltid lugn, premium.

Fokus:
- Fler kunder
- Starkare digital närvaro
- Smartare automation
- Bättre annonsering
- Effektivare kund- och affärsflöden

Regler:
- Du pratar ENDAST om sådant Zenvia World kan hjälpa till med:
  AI-automation, digital tillväxt, webb, kundupplevelse, annonsering, system.
- Du ger korta svar: 1–3 meningar, max.
- Du avslutar ofta med en enkel, relevant följdfråga.
- Du föreslår konsultation när användaren visar tydligt behov eller intresse.
- Du diskuterar INTE pris eller prisnivåer – bara värde, resultat och nästa steg.
- Om användaren frågar om pris: förklara att pris alltid baseras på behov och omfattning,
  och styr mot behovsanalys eller konsultation istället.
- Du föreslår inte detaljerade lösningar om inte användaren ber om det.
- Du är alltid lugn, saklig och tydlig.
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
Zenvia World hjälper företag att växa genom AI, automation, smartere system och moderna webb- och kundupplevelser. 
Kort sagt: vi kombinerar teknik och strategi för att skapa fler kunder och mindre manuellt arbete. 
Vad känns viktigast för dig – fler affärer eller effektivare vardag?
      `.trim()
    });
  }

  // "Jag jämför er med andra" – du sa "nej" på extra logik, så håll det kort & neutralt
  if (lower.includes("jämför") && lower.includes("andra")) {
    return res.json({
      reply: `
Det viktigaste är att ni hittar en partner som förstår både teknik och affär. 
Vi fokuserar på resultat, enkelhet och långsiktig tillväxt – inte enbart enskilda leveranser. 
Vad är viktigast för dig i ett samarbete?
      `.trim()
    });
  }

  // "Jag har väldigt liten budget" – vi kan arbeta med alla budgets
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
Ofta kompletterar vi befintligt arbete med automation, analys och smartare system. 
Finns det något du känner att ni saknar idag – t.ex. automation, AI eller bättre uppföljning?
      `.trim()
    });
  }

  // "Jag är bara nyfiken"
  if (lower.includes("bara nyfiken") || lower.includes("nyfiken bara")) {
    return res.json({
      reply: `
Inga problem – du är välkommen att utforska. 
Är du mest nyfiken på hur AI och automation kan effektivisera din vardag, eller hur det kan ge fler kunder?
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
     (styr direkt mot konsultation)
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
