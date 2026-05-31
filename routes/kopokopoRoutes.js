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
const Webhooks = K2.Webhooks;

// Route to initiate STK Push
router.post('/stk/push', async (req, res) => {
    const { phoneNumber, amount, orderId, firstName, lastName, email } = req.body;

    if (!phoneNumber || !amount || !orderId) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Format phone number to E.164 (SDK 2.0.0 expects +254...)
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
            paymentChannel: 'M-PESA STK Push', // MANDATORY for SDK 2.0.0
            tillNumber: process.env.KOPOKOPO_TILL_NUMBER.trim(),
            firstName: firstName || 'Customer',
            lastName: lastName || 'User',
            phoneNumber: formattedPhone,
            amount: amount.toString(),
            currency: 'KES',
            email: email || 'customer@example.com', // Expected by SDK subscriber mapping
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

        // Extract detailed error from K2 SDK or Axios response
        if (error.response) {
            console.error('Kopo Kopo Response Error:', error.response.data);
            errorMessage = error.response.data.error_description || error.response.data.error || errorMessage;
        } else if (error.message) {
            errorMessage = error.message;
        }

        // Specifically check for 401/Unauthorized
        if (errorMessage.toLowerCase().includes('unauthorized')) {
            errorMessage = "Kopo Kopo Authentication Failed: Check Client ID and Secret in Render Env Variables.";
        }

        res.status(500).json({ error: errorMessage });
    }
});

// Secure Callback route using SDK Signature Verification
router.post('/callback', async (req, res) => {
    try {
        // Webhooks.webhookHandler verifies the X-Kopokopo-Signature using your API_KEY
        const payload = await Webhooks.webhookHandler(req, res);
        console.log('Verified Kopo Kopo Callback:', JSON.stringify(payload));

        // SDK 2.0.0 payload structure: payload.data.attributes.event.resource
        const resource = payload.data && payload.data.attributes && payload.data.attributes.event && payload.data.attributes.event.resource;
        const metadata = (resource && resource.metadata) || {};
        const orderId = metadata.orderId;
        const status = resource && resource.status;

        if (orderId) {
            const db = admin.database();
            const orderRef = db.ref(`orders/${orderId}`);

            if (status === 'Success') {
                await orderRef.update({
                    status: 'Processing',
                    paymentStatus: 'Paid',
                    kopoKopoId: resource.id,
                    updatedAt: Date.now()
                });
                console.log(`✅ Order ${orderId} marked as Paid`);
            } else if (status === 'Failed') {
                await orderRef.update({
                    status: 'Failed',
                    paymentStatus: 'Failed',
                    updatedAt: Date.now()
                });
                console.log(`❌ Order ${orderId} marked as Failed`);
            }
        }
    } catch (error) {
        console.error('Webhook Verification Failed:', error);
        // The SDK's webhookHandler already sends the appropriate error status to Kopo Kopo
    }
});

module.exports = router;
