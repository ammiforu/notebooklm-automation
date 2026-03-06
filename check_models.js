const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function testModel() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Use 'gemini-flash-latest' which is the stable alias in this environment (2026)
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    const result = await model.generateContent("Hi");
    console.log("✅ API Key is working. Gemini Flash Latest responded.");
    console.log("Response:", result.response.text());
  } catch (error) {
    console.error("❌ API Error Details:", error);
  }
}

testModel();
