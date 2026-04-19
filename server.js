require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const multer = require('multer');
const fs = require('fs');
const { scanTicket } = require('./utils/scanner');

const app = express();
const port = 3000;
const upload = multer({ dest: 'uploads/' });

mongoose.connect(process.env.DATABASE_URL)
    .then(() => console.log("💾 MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Error:", err.message));

const User = mongoose.model('User', new mongoose.Schema({
    googleId: String,
    name: String,
    email: String,
    history: [{ 
        date: { type: Date, default: Date.now }, 
        store: String, 
        total: Number 
    }]
}));

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.use(express.static('public'));
app.use(express.json());

app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        let user = await User.findOne({ googleId: payload.sub });
        if (!user) {
            user = await User.create({
                googleId: payload.sub,
                name: payload.name,
                email: payload.email
            });
        }

        res.json({ name: user.name, googleId: user.googleId });
    } catch (error) {
        res.status(401).send("Auth Error");
    }
});

app.post('/api/comparer-ticket', upload.single('ticket'), async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    try {
        const userId = req.body.googleId; 
        const resultIA = await scanTicket(req.file.path);

        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        if (!resultIA || resultIA.error) {
            return res.status(500).json({ success: false, message: "AI Scan failed" });
        }

        if (userId) {
            await User.findOneAndUpdate(
                { googleId: userId },
                { 
                    $push: { 
                        history: { 
                            store: resultIA.enseigne, 
                            total: resultIA.total 
                        } 
                    } 
                }
            );
        }

        res.json({ 
            success: true,
            enseigneGagnante: resultIA.enseigne,
            prixTotal: resultIA.total,
            articles: resultIA.articles
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send("Server Error");
    }
});

app.listen(port, () => {
    console.log(`🚀 Server: http://localhost:${port}`);
});