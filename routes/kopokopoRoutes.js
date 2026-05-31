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

    // Format phone number to E.164 (Kopo Kopo SDK usually expects +254...)
    let formattedPhone = phoneNumber.replace(/\s+/g, '');
    if (formattedPhone.startsWith('0')) {
        formattedPhone = '+254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('254')) {
        formattedPhone = '+' + formattedPhone;
    } else if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+' + formattedPhone;
    }

    try {
        if (!process.env.KOPOKOPO_TILL_NUMBER || !process.env.CALLBACK_URL) {
            throw new Error('Backend Configuration Error: Missing TILL_NUMBER or CALLBACK_URL on Render');
        }

        console.log(`Initiating STK Push for ${formattedPhone}, Amount: ${amount}, Order: ${orderId}`);

        const tokenResponse = await TokenService.getToken();
        const accessToken = tokenResponse.access_token;

        if (!accessToken) {
            throw new Error('Failed to obtain access token from Kopo Kopo. Check your Client ID and Secret.');
        }

        const stkOptions = {
            tillNumber: process.env.KOPOKOPO_TILL_NUMBER.trim(),
            firstName: firstName || 'Customer',
            lastName: lastName || 'User',
            phoneNumber: formattedPhone,
            amount: amount.toString(), // Ensure amount is a string
            currency: 'KES',
            callbackUrl: process.env.CALLBACK_URL.trim(),
            accessToken: accessToken,
            metadata: {
                orderId: orderId
            }
        };

        const response = await StkService.initiateIncomingPayment(stkOptions);
        console.log('Kopo Kopo STK Success:', response);
        res.status(200).json({ success: true, location: response });
    } catch (error) {
        console.error('STK Error Detailed:', error);

        let errorMessage = 'Failed to initiate STK push';

        // Check for K2 SDK specific error responses
        if (error.response && error.response.data) {
            console.error('K2 Error Data:', JSON.stringify(error.response.data));
            errorMessage = error.response.data.error_description ||
                           error.response.data.error ||
                           JSON.stringify(error.response.data);
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ error: errorMessage });
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
