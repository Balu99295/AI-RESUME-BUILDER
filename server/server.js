const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { Schema } = mongoose;
dotenv.config();


const app = express();
const upload = multer({ dest: "uploads/" });

// Enable parsing JSON bodies
app.use(express.json());

// 2. Define the Resume Schema
const resumeSchema = new Schema({
    extractedText: String,
    template: String,
    selectedTemplate: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});
// 3. Create the Resume Model
const Resume = mongoose.model('Resume', resumeSchema);


mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("Failed to connect to MongoDB:", err));

app.use(express.static(path.join(__dirname, '../client/public')));

// Initialize the Gemini Pro API client with the API key from .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

app.post("/upload", upload.single("resume"), async (req, res) => {
    try {
        const filePath = req.file.path;
        const pdfBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(pdfBuffer);
        fs.unlinkSync(filePath);

        const extractedText = data.text;
        const newFileName = `extracted-text-${Date.now()}.txt`;
        const newFilePath = path.join(__dirname, 'extracted_text', newFileName);

          // Check if 'extracted_text' directory exists, if not create it
          const extractedTextDir = path.join(__dirname, 'extracted_text');
          if (!fs.existsSync(extractedTextDir)) {
              fs.mkdirSync(extractedTextDir, { recursive: true });
          }

          fs.writeFileSync(newFilePath, extractedText, "utf-8");

          //Get template name from frontend request body
          const selectedTemplate = req.body.template || "tempA" ; // Assuming tempA is selected by default


         // Load LaTeX template (assuming it's named tempA.tex)
         const templatePath = path.join(__dirname, 'templates', `${selectedTemplate}.tex`);
         const latexTemplate = fs.readFileSync(templatePath, 'utf-8');


        // Call Gemini API for HTML conversion
        const prompt = `Analyze the following resume text and convert it to HTML and css code, use the following Latex Template as a formatting guide and preserve the LaTeX formatting styles. The response should be a single HTML document with the content from the parsed PDF text correctly formatted.Just return the final html code without any extra words and the main goal and target is to preserve the latex code format in the final html code. 
         Resume Text: ${extractedText}
         LaTeX Template: ${latexTemplate}
         `;

        const result = await model.generateContent(prompt);
        const generatedHTML = result.response.text();

        const resumeData = new Resume({
            extractedText,
            template: templatePath, //Storing path of the template in db
            selectedTemplate, //Store the selected template by user in db
        });
       // 6. Save to db
        await resumeData.save(); // Ensure it has been saved before responding

        // Respond to the client after saving, and sending it to Gemini
        res.json({
            success: true,
            message: "PDF processed and converted to HTML successfully!",
           generatedHTML: generatedHTML,
           latexTemplate: latexTemplate, // Send latex template back to client
        });
    } catch (error) {
        console.error("Error processing PDF:", error);
        res.status(500).json({ success: false, message: "Failed to process PDF" });
    }
});

app.get("/resumes", async (req, res) => {
    try {
        const resumes = await Resume.find().sort({ createdAt: -1 }); // Latest first
        res.json({ success: true, data: resumes });
    } catch (error) {
        console.error("Error fetching resumes:", error);
        res.status(500).json({ success: false, message: "Failed to fetch resumes" });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});