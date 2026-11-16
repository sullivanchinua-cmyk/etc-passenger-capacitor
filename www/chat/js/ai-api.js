// ============================================================
// ETC Chat – AI API  (Google Gemini)
// ============================================================

const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE";
// gemini-3.1-flash-lite → Gemini Flash Lite (fast + cheap)
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

const ETC_SYSTEM = `You are ETC AI, the assistant inside the Enugu Transport Corporation chat. You help passengers with bus routes, terminals, fares, ticket booking, seat selection, boarding and trip questions around Enugu, Nigeria. Be concise, friendly and accurate. If you do not know a live fact (a fare, a departure time, a seat count), say so and point to the app instead of guessing. You can speak fluent Nigerian Pidgin when asked.`;

// ─── Main ask function ────────────────────────────────────────
async function askAI(question, context = null) {
  const prompt = context
    ? `Context: ${context}\n\nQuestion: ${question}`
    : question;

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: ETC_SYSTEM }] },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
        ],
        generationConfig: { maxOutputTokens: 600, temperature: 0.7 }
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!answer) throw new Error("Empty response");

    // Save to Firebase conversation history
    if (typeof db !== "undefined" && currentUser) {
      db.ref(`ai_chats/${currentUser.uid}`).push({
        question, answer, timestamp: Date.now()
      });
    }

    return { success: true, answer, provider: "Gemini" };

  } catch (err) {
    console.warn("Gemini error, using fallback:", err.message);
    return { success: true, answer: getEtcFallback(question), provider: "Offline" };
  }
}

// --- ETC fallback answers (used when no Gemini key is set) -------------------------
function getEtcFallback(q) {
  q = (q || "").toLowerCase();
  if (q.includes("ticket") || q.includes("book")) return "**Booking a ticket**:\n\u2022 Open a route, tap Book Ticket\n\u2022 Pick your seat, add passengers and luggage\n\u2022 Pay, then show the QR code at the gate";
  if (q.includes("seat")) return "**Seats**:\n\u2022 Seats are laid out A B | aisle | C D\n\u2022 1A and 1B are priority seats\n\u2022 A taken seat cannot be chosen again";
  if (q.includes("fare") || q.includes("price") || q.includes("cost")) return "Fares depend on the route \u2014 open the route in the passenger app to see the live fare.";
  if (q.includes("terminal") || q.includes("route")) return "Open the Map tab to see terminals and routes, with live time estimates for bus, car, tricycle and walking.";
  if (q.includes("refund") || q.includes("cancel")) return "For cancellations and refunds, open the ticket in My Tickets or message an agent in this chat.";
  return "\ud83d\udc4b Hi! I'm **ETC AI**.\n\nI can help with:\n\ud83d\ude8c Routes & terminals\n\ud83c\udfab Tickets & booking\n\ud83d\udcba Seats\n\ud83d\udcb3 Fares\n\nAsk me anything about your trip.";
}

// ─── ETC travel tips ───────────────────────────
function getETCTips() {
  return [
    { title: "Arrive early", description: "Be at the terminal 20 minutes before departure so boarding is calm.", category: "Travel" },
    { title: "Keep your QR ready", description: "Open the ticket before you reach the gate - agents scan it to board you.", category: "Tickets" }
  ];
}

console.log("✅ AI ready → Gemini (...)");
