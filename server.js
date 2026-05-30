const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const kopokopoRoutes = require('./routes/kopokopoRoutes');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api', kopokopoRoutes);

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`🚀 Kopo Kopo Backend running on: http://localhost:${PORT}`);
    console.log(`⚠️ Make sure your .env file is configured.`);
});
