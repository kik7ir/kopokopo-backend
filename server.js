const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Firebase Database URL (REST API Endpoint)
const DB_URL = "https://school-system-a97a4-default-rtdb.firebaseio.com/storeInfo.json";

/**
 * KOPO KOPO STK PUSH (M-PESA PAYMENT CALL)
 */
app.post('/mpesa/stkpush', async (req, res) => {
    let { phoneNumber, amount, orderId, firstName, lastName } = req.body;

    try {
        console.log("\n🔄 Syncing Kopo Kopo keys...");
        const dbResponse = await axios.get(DB_URL);
        const config = dbResponse.data || {};

        // Credentials from your .env file
        const CLIENT_ID = process.env.KOPOKOPO_CLIENT_ID;
        const CLIENT_SECRET = process.env.KOPOKOPO_CLIENT_SECRET;
        const API_KEY = process.env.KOPOKOPO_API_KEY;
        const TILL_NUMBER = process.env.KOPOKOPO_TILL_NUMBER;

        const isSandbox = false; // Set to false for Live Account
        const BASE_URL = isSandbox ? 'https://sandbox.kopokopo.com' : 'https://api.kopokopo.com';

        console.log(`🚀 Kopo Kopo STK Push: ${orderId} | Env: ${isSandbox ? 'SANDBOX' : 'PRODUCTION'}`);

        // 1. Get OAuth Access Token
        const tokenResp = await axios.post(`${BASE_URL}/oauth/token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'client_credentials'
        });
        const accessToken = tokenResp.data.access_token;
        console.log("✅ Kopo Kopo Token obtained.");

        // 2. Format Phone Number (Kopo Kopo prefers +254...)
        let formattedPhone = phoneNumber.replace(/\D/g, '');
        if (!formattedPhone.startsWith('254')) {
            if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);
            else formattedPhone = '254' + formattedPhone;
        }
        formattedPhone = '+' + formattedPhone;

        // 3. Initiate Payment Call (STK Push)
        const callbackUrl = config.mpesaCallbackUrl || 'https://your-domain.com/mpesa/callback';

        console.log(`📡 Sending request to Kopo Kopo: ${BASE_URL}/api/v1/incoming_payments`);

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
                callback_url: `${callbackUrl}?orderId=${orderId}`
            }
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Kopo Kopo Request Sent:', paymentResponse.status);

        // Kopo Kopo returns 201 Created and a Location header for tracking
        res.json({
            ResponseCode: "0",
            CustomerMessage: "Payment request sent to phone.",
            CheckoutRequestID: paymentResponse.headers.location || orderId
        });

    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error('❌ Kopo Kopo Error:', JSON.stringify(errorData, null, 2));
        res.status(500).json({
            message: 'Kopo Kopo Request Failed',
            details: errorData
        });
    }
});

/**
 * KOPO KOPO CALLBACK LISTENER
 */
app.post('/mpesa/callback', async (req, res) => {
    const { orderId } = req.query;
    const payload = req.body;

    console.log(`\n🔔 Kopo Kopo Callback Received for Order: ${orderId}`);

    try {
        const orderUpdateUrl = `https://school-system-a97a4-default-rtdb.firebaseio.com/orders/${orderId}.json`;

        // Kopo Kopo status is usually in payload.data.attributes.status
        const status = payload.data?.attributes?.status;
        const event = payload.data?.attributes?.event;

        if (status === 'Success' || (event && event.type === 'Payment Received')) {
            const resource = payload.data.attributes.event.resource;
            const receipt = resource.reference || resource.system_generate_number;

            console.log(`✅ Payment SUCCESS for Order ${orderId}. Receipt: ${receipt}`);

            await axios.patch(orderUpdateUrl, {
                status: 'Preparing Your Order',
                mpesaReceiptNumber: receipt,
                paidAt: new Date().toISOString()
            });
        } else if (status === 'Failed') {
            console.log(`❌ Payment FAILED for Order ${orderId}`);
            await axios.patch(orderUpdateUrl, {
                status: 'Failed',
                failureReason: 'Payment was unsuccessful or cancelled.'
            });
        }
    } catch (error) {
        console.error('❌ Callback Processing Error:', error.message);
    }

    res.sendStatus(200);
});

const PORT = 5001;
app.get('/ping', (req, res) => res.send('Backend is running on 5001'));
app.listen(PORT, () => {
    console.log(`🚀 Kopo Kopo Payment server running on http://localhost:${PORT}`);
});
