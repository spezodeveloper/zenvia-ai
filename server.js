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
  const userMessage = req.body.message;
  const intent = req.body.intent || null;

  // ---- AI ONBOARDING LOGIC ----
  let systemBehavior = `
Du är Zenvia Worlds digitala AI-rådgivare.
Du guidar företagare steg-för-steg mot tydliga beslut.
Du svarar kort, tydligt, professionellt och alltid affärsfokuserat.

Regler:
- Om användaren gör ett onboarding-val (intent), svara med nästa steg.
- Varje onboarding-steg ska avslutas med en fråga + 2–4 val (knappar genereras i frontend).
- Du får ENDAST prata om Zenvia och det vi erbjuder.
- Du ska alltid koppla valen till konkreta affärsfördelar.
- Om användaren visar köpintresse: föreslå “Boka konsultation”.
- Avsluta ALDRIG ett svar utan en tydlig nästa fråga, förrän användaren visar köpintresse.

Zenvia erbjuder:
- AI Automation
- Digital tillväxt & analys
- Webbdesign + AI
- Intelligenta digitala system
- Prediktiv tillväxtanalys
- Automatiserad marknadsföring
- Konverteringsoptimering
- Skalbara affärsprocesser
  `;

  // ---- CUSTOM FLOWS ----
  if (intent === "fler kunder") {
    return res.json({
      reply: `
Toppen — fokus på *fler kunder*.  
Det betyder oftast att vi kan hjälpa dig genom en kombination av:

• **Automatiserad marknadsföring** som hittar rätt målgrupper.  
• **Konverteringsoptimering** så fler faktiskt blir kunder.  
• **Prediktiv analys** som visar vad som fungerar bäst.

För att guida dig rätt:  
**Var får du idag in flest kunder?**

1️⃣ Sociala medier  
2️⃣ Google  
3️⃣ Hemsidan  
4️⃣ Vet inte / oklart
      `
    });
  }

  if (intent === "hemsida") {
    return res.json({
      reply: `
En ny hemsida är ofta ett av de snabbaste sätten att öka förtroende och kunder.

Vi bygger moderna, snabba, AI-förstärkta hemsidor som:

• guidar besökare automatiskt  
• svarar på frågor i realtid  
• ökar konvertering direkt  

Snabb fråga:  
**Har du redan en hemsida idag?**

1️⃣ Ja, men den fungerar inte bra  
2️⃣ Ja, men behöver uppdateras  
3️⃣ Nej, jag behöver en helt ny  
4️⃣ Jag är osäker
      `
    });
  }

  if (intent === "automation") {
    return res.json({
      reply: `
Automatisering kan spara massor av tid och samtidigt öka intäkterna.

Vi bygger system som sköter:

• kundflöden  
• uppföljningar  
• segmentering  
• lead-kvalificering  

För att hitta rätt lösning:  
**Vilken del av företaget vill du automatisera först?**

1️⃣ Kundhantering  
2️⃣ Marknadsföring  
3️⃣ Bokningar / förfrågningar  
4️⃣ Intern administration
      `
    });
  }

  if (intent === "annonsering") {
    return res.json({
      reply: `
Smart annonsering är en genväg till fler affärer — *om den görs datadrivet*.

Vi hjälper företag att:

• skapa AI-optimerade kampanjer  
• automatisera budgetstyrning  
• förbättra målgrupper och resultat  

Snabb fråga:  
**Vad är ditt största annonsproblem idag?**

1️⃣ För dyrt / låg ROAS  
2️⃣ För få leads  
3️⃣ Får klick men inga kunder  
4️⃣ Helt ny inom annonsering
      `
    });
  }

  if (intent === "konsultation") {
    return res.json({
      reply: `
Självklart! Du kan boka en gratis konsultation här:

👉 **https://zenvia.world/pages/boka-konsultation**

Vill du att jag snabbt sammanfattar ditt behov inför mötet?
      `
    });
  }

  // ---- DEFAULT: NORMAL AI-ANSWER ----
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemBehavior },
      { role: "user", content: userMessage }
    ]
  });

  res.json({
    reply: completion.choices[0].message.content
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Zenvia AI körs på port ${PORT}`));
