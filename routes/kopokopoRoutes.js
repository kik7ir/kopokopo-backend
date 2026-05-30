const express = require('express');
const router = express.Router();
const kopokopoController = require('../controllers/kopokopoController');

router.post('/stkpush', kopokopoController.stkPush);
router.post('/callback', kopokopoController.handleCallback);

module.exports = router;
