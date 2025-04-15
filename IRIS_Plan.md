IRIS Plan
Deze feature berekent de maandelijkse omzet van projecten en offertes op basis van geschreven uren in Gripp, gespecificeerd naar projecttype (vaste prijs, nacalculatie, intern). De weergave is per maand per project, inclusief validatiemogelijkheid via toggle tussen 'Uren' en 'Omzet'.
Opmerking: Deze implementatie wordt momenteel ontwikkeld als losstaande applicatie en hoeft dus geen rekening te houden met andere delen of afhankelijkheden binnen de bestaande applicatieomgeving.

🟢 ALGEMEEN DOEL: Een overzicht creëren op de pagina /revenue waarin per project en per maand de gerealiseerde omzet of geschreven uren worden weergegeven. Dit helpt bij het analyseren van opbrengsten en projectverloop.
Het overzicht bevat:
Horizontale as: Maanden van een gekozen jaar (initieel 2025)


Verticale as: Projecten en offertes waarop uren geschreven zijn


Celinhoud: Aantal geschreven uren of berekende omzet (wisselbaar via toggle)


Extra kolommen voor: Company, Type project, Handmatig opgegeven eerdere omzet



🧩 TOE TE VOEGEN KOLLOMMEN IN DE TABEL:
Company


Haal op via company.searchname uit project.get of offer.get


Toon in een kolom "Company" per rij


Type


Bepaal via tags in project.get of offer.get


Mapping:


Tag vaste prijs → Type = "Vaste prijs"


Tag nacalculatie → Type = "Nacalculatie"


Tag contract → Type = "Contract"


Tag intern → Type = "Intern"


Elke andere tag of het ontbreken ervan → Type = "Incorrecte tag"


Handmatig opgegeven eerdere omzet (2024)


Alleen voor vaste prijs projecten


Wordt handmatig ingevoerd door de gebruiker via een aparte, bewerkbare kolom in de tabel per project.


Deze kolom ("Eerdere Omzet") toont en slaat de cumulatieve omzet op die vóór het begin van het geselecteerde jaar is gerealiseerd.


De ingevoerde waarde is aanpasbaar, wordt persistent opgeslagen, en wordt direct meegenomen in de berekening van het resterende projectbudget voor Vaste Prijs projecten.


Herkomst (Nieuw)


Waarde = "Project" of "Offerte"


Bepalen op basis van discr veld uit offerprojectbase (waarde = "offerte") of project.get (waarde = "opdracht")


Toon in een eigen kolom zodat het verschil visueel duidelijk is in het overzicht



NACALCULATIEPROJECTEN
🟢 DOEL: Bereken per maand de omzet van nacalculatieprojecten: geschreven uren × tarief per individuele uurregel.
⚠️ CRUCIALE INSTRUCTIES:
❌ Nooit demo- of testdata gebruiken!


✅ Controleer of verkoopuurtarieven uit offerprojectlines.get niet elders in de applicatie gebruikt of gemuteerd worden (indien later geïntegreerd).


🧠 Beperk alles tot de omzetweergave binnen de losstaande applicatie.


🛟 Maak een herstelpunt aan.


✍️ OPDRACHT:
Gebruik hour.get om alle geschreven uren op te halen.


Groepeer geschreven uren per maand.


Doorloop per uurregel:


Gebruik offerprojectline.id om de juiste lijn op te zoeken via offerprojectlines.get


Haal het bijbehorende tarief op (sellingprice)


Vermenigvuldig met het aantal uren (amountwritten)


Tel deze omzetbedragen op per maand per project of offerte


Toon in omzet-weergave


📎 TIP: Meerdere tarieven binnen een maand per project worden afzonderlijk berekend en opgeteld.
🧾 Offerprojectline mapping structuur:
{
  "offerprojectline.id": 61549,
  "product": {
    "searchname": "Art direction (20042)"
  },
  "sellingprice": "105.00",
  "amountwritten": "1.5",
  "offerprojectbase": {
    "searchname": "ADE - ADE x Soundcloud (2201)",
    "discr": "opdracht"
  }
}
Gebruik discr om herkomst te bepalen, en sellingprice × amountwritten voor omzet.

VASTE PRIJS PROJECTEN
🟢 DOEL: Bereken omzet per maand, met controle op het maximale projectbudget. Zodra het budget (incl. eerdere omzet) is bereikt, worden extra uren gewaardeerd op €0,-.
⚠️ CRUCIALE INSTRUCTIES:
❌ Geen testdata


✅ Werk met geïsoleerde data in deze aparte toepassing


🛟 Maak een herstelpunt


✍️ OPDRACHT:
Stap 1: Voorbereiding data
Verzamel alle geschreven uren per project/offerte, gegroepeerd per maand en per project-/offerteregel.


Haal per project-/offerteregel (uit `projectlines.get` of `offerprojectlines.get`, afhankelijk van 'Herkomst') de volgende gegevens op:


amount (begrote uren)


sellingPrice (uurtarief)


amountWritten (totale reeds geschreven uren *vóór de huidige calculatieperiode*)


Stap 2: Verwerken van eerdere omzet
Bepaal per project de eerder gerealiseerde omzet (uit de bewerkbare kolom "Eerdere Omzet").


Bereken het resterend beschikbare projectbudget:


resterend_budget_project = totaal_projectbudget - reeds_gerealiseerde_omzet
Stap 3: Berekening omzet per geschreven uur
Doorloop geschreven uren per maand per projectregel:


Bereken:


resterende_uren_regel = amount - amountWritten

Voor elke geschreven uur:


Als amountWritten < amount én er is budget over: omzet = sellingPrice (*Hierbij is `amountWritten` het totaal aantal uren geschreven op de regel vóór de start van de huidige berekeningsmaand.*)


Als regelbudget of projectbudget bereikt is: omzet = €0,-


Stap 4: Toepassing plafond op projectniveau
Check continu of de totale omzet kleiner is dan resterend_budget_project


Zodra deze is bereikt: geen verdere omzet, ook niet op andere regels


📎 Voorbeeld:
Regel A: 100 uur à €100 → max €10.000


Regel B: 50 uur à €120 → max €6.000


Totaal budget = €16.000


Reeds gerealiseerd = €5.000 → Resterend = €11.000


Nieuwe uren: eerst max. 20 uur Regel A, daarna max. 50 uur Regel B, max. 11.000 totaal


✅ Validatie:
Omzet nooit > regelmaximum


Omzet nooit > projectmaximum


Eerdere omzet meenemen in plafond


🧾 Projectline mapping structuur:
{
  "id": 64403,
  "product": {
    "searchname": "Project Management (20036)"
  },
  "amount": 100,
  "sellingprice": "105.00",
  "amountwritten": "42.5",
  "offerprojectbase": {
    "searchname": "MyAccount - Fase 2 - Development (2360)",
    "discr": "opdracht"
  }
}
Gebruik amount × sellingprice als regelplafond. Monitor cumulatief per project.

OVERIG:
✅ Toggle tussen 'Uren' en 'Omzet'
Visuele knop boven tabel


Alleen weergave verandert, data blijft gelijk


Default: 'Uren' voor validatie


✅ Interne projecten
Herken op tag 'intern' → Type = Intern


Alle omzet per maand = €0,-


✅ Offertes als aparte entiteit tonen
Gebruik offer.get voor alle offertes


Schrijfuren op offertes worden op dezelfde manier verwerkt als bij projecten


Toon in overzicht met visuele indicator (bv. tag of kolom 'Herkomst' = "Offerte")


✅ Projecten als entiteit
Gebruik project.get om projecten en bijbehorende projectregels (projectlines) op te halen


Herkomst = "Project" (via discr = opdracht)


Gebruik product.searchname, sellingprice, en amount uit projectlines voor tarief-lookup



🔁 Data-integratie & performance strategie
Omdat deze applicatie volledig leunt op Gripp API data, hanteren we een robuuste en gestructureerde aanpak om performance, betrouwbaarheid en schaalbaarheid te waarborgen:
Volledige datasynchronisatie:


Haal gestructureerd alle benodigde data op uit Gripp via de beschikbare endpoints


Gebruik filters en paginatie om volledige en consistente datasets op te bouwen


Lokale opslag in database:


Sla alle ruwe data tijdelijk lokaal op (bijv. in SQLite of PostgreSQL), zodat bewerkingen snel en herhaalbaar zijn


Slimme cache-laag:


Gebruik een caching-strategie (bijv. per maand/per project) zodat herberekeningen alleen plaatsvinden bij updates of expliciete refresh


Mogelijkheid tot handmatige of geplande synchronisatie met Gripp (bv. 1x per uur of bij aanpassing)


Validatie op volledigheid:


Controleer per entiteit of alle benodigde velden aanwezig zijn (bijv. amountwritten, sellingprice, offerprojectbase, enz.)


API-verbruik minimaliseren:


Werk in batch requests (max. 250 items per call)


Respecteer rate limits: 1000 req/uur, max 20 tokens/s


Toekomstige extensies:


Koppeling met webhook-architectuur van Gripp mogelijk


Historie-log of delta-synchronisatie (alleen gewijzigde records ophalen)



## 🛠️ Tech Stack

De volgende technologieën zullen worden gebruikt voor de ontwikkeling van deze applicatie:

**Frontend:**
*   **React:** JavaScript library voor de gebruikersinterface (.tsx, hooks, JSX).
*   **TypeScript:** Statische typing voor frontend code.
*   **Vite:** Build tool en development server.
*   **Shadcn UI:** UI componenten (gebaseerd op Tailwind CSS).
*   **Lucide React:** Iconen.
*   **Axios:** HTTP requests naar de backend API.
*   **Zustand:** State management.

**Backend (API Server):**
*   **Node.js:** Runtime omgeving.
*   **Express.js:** Web framework voor de API.
*   **TypeScript:** Statische typing voor backend code.
*   **tsx:** Voor directe uitvoering van TypeScript bestanden.
*   **SQLite:** Relationele database voor lokale data opslag.
*   **(node-)fetch:** Voor externe API calls (Gripp API).
*   **node-cache:** In-memory caching.
*   **Dotenv:** Beheer van environment variabelen.
*   **CORS:** Middleware voor Cross-Origin Resource Sharing.
*   **express-rate-limit:** Middleware voor API rate limiting.

**Algemeen / Tooling:**
*   **npm:** Package manager en script runner.
*   **Concurrently:** Voor het gelijktijdig uitvoeren van meerdere scripts.



