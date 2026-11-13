require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for pending registrations & verified users
const pendingRegistrations = new Map();
const verifiedUsers = [];

// Configure Nodemailer transporter using Gmail App Passwords
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Endpoint 1: Receive User Details & Send OTP with Summary Email
app.post('/api/send-otp', async (req, res) => {
    const { name, age, sex, phone, aadhaar, location, email } = req.body;
    
    if (!email || !name || !phone || !aadhaar) {
        return res.status(400).json({ success: false, message: 'Please fill in all required personal details.' });
    }

    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // Valid for 5 minutes

    // Store user data and OTP temporarily
    pendingRegistrations.set(email, {
        userData: { name, age, sex, phone, aadhaar, location, email },
        otp,
        expiresAt
    });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'AI-Health Prioritizer - Registration OTP & Summary',
        text: `Hello ${name},\n\n` +
              `Thank you for registering with the AI-Health Appointment Prioritizer.\n` +
              `Your one-time verification code is: ${otp} (Valid for 5 minutes).\n\n` +
              `--- Registered Details Summary ---\n` +
              `Name: ${name}\n` +
              `Age: ${age}\n` +
              `Sex: ${sex}\n` +
              `Phone: ${phone}\n` +
              `Identity Card No: [Redacted]\n` +
              `Location: ${location}\n` +
              `Email: ${email}\n\n` +
              `If you did not request this, please ignore this email.`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`OTP and details summary sent to ${email}: ${otp}`);
        res.json({ success: true, message: 'Details received! Verification email sent with your registration summary.' });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ success: false, message: 'Failed to send OTP email. Check your server configuration.' });
    }
});

// Endpoint 2: Verify OTP and Finalize Registration
app.post('/api/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
        return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    const record = pendingRegistrations.get(email);

    if (!record) {
        return res.status(400).json({ success: false, message: 'No pending registration found for this email.' });
    }

    if (Date.now() > record.expiresAt) {
        pendingRegistrations.delete(email);
        return res.status(400).json({ success: false, message: 'OTP has expired. Please restart registration.' });
    }

    if (record.otp !== otp) {
        return res.status(400).json({ success: false, message: 'Invalid OTP code. Please try again.' });
    }

    verifiedUsers.push(record.userData);
    pendingRegistrations.delete(email);

    res.json({ 
        success: true, 
        message: 'Email verified successfully! Registration complete.',
        user: record.userData 
    });
});

// Endpoint 3: AI Chatbot using the new Interactions API (`ai.interactions.create`)
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('CRITICAL: GEMINI_API_KEY is missing from environment variables.');
        return res.status(500).json({ success: false, message: 'Gemini API Key is not configured on the server.' });
    }

    const ai = new GoogleGenAI({ apiKey: apiKey });

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            attempt++;
            
            // Using the Interactions API structure as outlined in the documentation
            const interaction = await ai.interactions.create({
                model: 'gemini-3.8-flash', // You can also use 'gemini-2.0-flash'
                input: message
            });

            const aiReply = interaction.outputText || 'I am sorry, I could not process that request right now.';
            return res.json({ success: true, reply: aiReply });

        } catch (error) {
            console.error(`Gemini Interactions Error (Attempt ${attempt}/${maxRetries}):`, error.message || error);

            // If it's a 503 high demand error, wait 1.5 seconds and retry automatically
            if (error.status === 503 && attempt < maxRetries) {
                console.log('Server experiencing high demand. Retrying in 1.5 seconds...');
                await new Promise(resolve => setTimeout(resolve, 1500));
                continue;
            }

            if (attempt >= maxRetries) {
                return res.status(503).json({ 
                    success: false, 
                    message: 'The AI assistant is currently experiencing high traffic. Please try again in a moment.' 
                });
            }

            return res.status(500).json({ success: false, message: 'Failed to communicate with AI assistant.' });
        }
    }
});
// Start Server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});