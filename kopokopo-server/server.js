const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Credentials pulled from .env for security
const CLIENT_ID = process.env.KOPOKOPO_CLIENT_ID;
const CLIENT_SECRET = process.env.KOPOKOPO_CLIENT_SECRET;
const TILL_NUMBER = process.env.KOPOKOPO_TILL_NUMBER;
const BASE_URL = 'https://api.kopokopo.com';

/**
 * 1. STK PUSH TRIGGER
 */
app.post('/stkpush', async (req, res) => {
    const { phoneNumber, amount, orderId, firstName, lastName } = req.body;

    try {
        // Get Access Token
        const tokenResp = await axios.post(`${BASE_URL}/oauth/token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'client_credentials'
        });
        const accessToken = tokenResp.data.access_token;

        // Format Phone (+254...)
        let formattedPhone = phoneNumber.replace(/\D/g, '');
        if (!formattedPhone.startsWith('254')) {
            if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);
            else formattedPhone = '254' + formattedPhone;
        }
        formattedPhone = '+' + formattedPhone;

        // Note: For local testing, use a service like ngrok for the callback URL
        const callbackUrl = process.env.CALLBACK_URL || `https://your-ngrok-url.ngrok-free.app/callback?orderId=${orderId}`;

        const paymentResponse = await axios.post(`${BASE_URL}/api/v1/incoming_payments`, {
            payment_channel: 'm-pesa',
            till_number: TILL_NUMBER,
            subscriber: {
                first_name: firstName || 'Customer',
                last_name: lastName || 'User',
                phone_number: formattedPhone,
                email: 'customer@example.com'
            },
            amount: {
                currency: 'KES',
                value: amount.toString()
            },
            metadata: {
                order_id: orderId,
                customer_name: `${firstName} ${lastName}`
            },
            _links: {
                callback_url: callbackUrl
            }
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        res.json({
            ResponseCode: "0",
            CustomerMessage: "Payment request sent to phone.",
            CheckoutRequestID: paymentResponse.headers.location || orderId
        });

    } catch (error) {
        console.error('❌ Kopo Kopo Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Request Failed' });
    }
});

/**
 * 2. CALLBACK HANDLER (Local testing)
 */
app.post('/callback', (req, res) => {
    const { orderId } = req.query;
    console.log(`\n🔔 Local Callback for Order: ${orderId}`);
    console.log(JSON.stringify(req.body, null, 2));
    res.sendStatus(200);
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`🚀 Kopo Kopo Local Server: http://localhost:${PORT}`);
    console.log(`⚠️ Remember to create a .env file with your credentials!`);
});
