const express = require('express');
const router = express.Router();
const kopokopoController = require('../controllers/kopokopoController');

router.post('/stkpush', kopokopoController.stkPush);
router.post('/callback', kopokopoController.handleCallback);
router.post('/webhook', kopokopoController.webhook);

module.exports = router;
