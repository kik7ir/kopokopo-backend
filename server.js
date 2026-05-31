const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        console.log('✅ Firebase Admin Initialized');
    } catch (error) {
        console.error('❌ FIREBASE_SERVICE_ACCOUNT Parse Error:', error.message);
        console.error('Check your Render Environment variables. Ensure you pasted the FULL JSON content.');
    }
} else {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not found in environment variables');
}

const kopokopoRoutes = require('./routes/kopokopoRoutes');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Routes
app.use('/api', kopokopoRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Kopo Kopo Backend is running' });
});

// Legacy Ping
app.get('/ping', (req, res) => res.send('Backend is running'));

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Kopo Kopo Backend running on port ${PORT}`);
});
