const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const K2 = require('k2-connect-node')({
    clientId: process.env.KOPOKOPO_CLIENT_ID,
    clientSecret: process.env.KOPOKOPO_CLIENT_SECRET,
    baseUrl: process.env.KOPOKOPO_BASE_URL,
    apiKey: process.env.KOPOKOPO_API_KEY
});

const StkService = K2.StkService;
const TokenService = K2.TokenService;

// Route to initiate STK Push
router.post('/stk/push', async (req, res) => {
    const { phoneNumber, amount, orderId, firstName, lastName } = req.body;

    if (!phoneNumber || !amount || !orderId) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Format phone number to E.164 if needed (assuming Kenya +254)
    let formattedPhone = phoneNumber.replace(/\s+/g, '');
    if (formattedPhone.startsWith('0')) {
        formattedPhone = '+254' + formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+' + formattedPhone;
    }

    try {
        const tokenResponse = await TokenService.getToken();
        const accessToken = tokenResponse.access_token;

        const stkOptions = {
            tillNumber: process.env.KOPOKOPO_TILL_NUMBER,
            firstName: firstName || 'Customer',
            lastName: lastName || '',
            phoneNumber: formattedPhone,
            amount: amount,
            currency: 'KES',
            callbackUrl: process.env.CALLBACK_URL,
            accessToken: accessToken,
            metadata: {
                orderId: orderId
            }
        };

        const response = await StkService.initiateIncomingPayment(stkOptions);
        res.status(200).json({ success: true, location: response });
    } catch (error) {
        console.error('STK Error:', error);
        res.status(500).json({ error: error.message || 'Failed to initiate STK push' });
    }
});

// Callback route for Kopo Kopo webhooks
router.post('/callback', async (req, res) => {
    try {
        const payload = req.body;
        console.log('Kopo Kopo Callback Received:', JSON.stringify(payload));

        const eventType = payload.event && payload.event.type;
        const resource = payload.event && payload.event.resource;
        const metadata = (resource && resource.metadata) || {};
        const orderId = metadata.orderId;
        const status = resource && resource.status;

        if (orderId) {
            console.log(`Processing payment for Order: ${orderId}, Status: ${status}`);

            const db = admin.database();
            const orderRef = db.ref(`orders/${orderId}`);

            if (status === 'Success') {
                await orderRef.update({
                    status: 'Processing',
                    paymentStatus: 'Paid',
                    kopoKopoId: resource.id,
                    updatedAt: Date.now()
                });

                // Also record in payments node
                await db.ref(`payments/${orderId}`).set({
                    orderId,
                    amount: resource.amount,
                    phoneNumber: resource.sender_phone_number,
                    status: 'Success',
                    timestamp: Date.now(),
                    kopoKopoId: resource.id
                });

                console.log(`✅ Order ${orderId} marked as Processing`);
            } else if (status === 'Failed') {
                await orderRef.update({
                    status: 'Failed',
                    paymentStatus: 'Failed',
                    updatedAt: Date.now()
                });
                console.log(`❌ Order ${orderId} marked as Failed`);
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Callback Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
