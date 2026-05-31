const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

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
