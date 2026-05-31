const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();

/**
 * KOPO KOPO STK PUSH (Incoming Payments)
 * Accesses secrets securely via Firebase Secret Manager.
 * These values are NEVER exposed to the frontend/browser.
 */
exports.stkpush = functions.runWith({
    secrets: ["KOPOKOPO_CLIENT_ID", "KOPOKOPO_CLIENT_SECRET", "KOPOKOPO_TILL_NUMBER"]
}).https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    // Load secrets from process.env (Injected securely by Firebase)
    const CLIENT_ID = process.env.KOPOKOPO_CLIENT_ID;
    const CLIENT_SECRET = process.env.KOPOKOPO_CLIENT_SECRET;
    const TILL_NUMBER = 'K000000'; // Sandbox Till Number
    const BASE_URL = 'https://sandbox.kopokopo.com';

    const { phoneNumber, amount, orderId, firstName, lastName } = req.body;

    try {
        // 1. Get OAuth Access Token
        const tokenResp = await axios.post(`${BASE_URL}/oauth/token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'client_credentials'
        });
        const accessToken = tokenResp.data.access_token;

        // 2. Format Phone Number (+254...)
        let formattedPhone = phoneNumber.replace(/\D/g, '');
        if (!formattedPhone.startsWith('254')) {
            if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);
            else formattedPhone = '254' + formattedPhone;
        }
        formattedPhone = '+' + formattedPhone;

        // 3. Initiate Kopo Kopo STK Push
        // We use the full cloudfunctions.net URL for the callback as Kopo Kopo needs a public absolute URL
        const projectId = process.env.GCLOUD_PROJECT || 'school-system-a97a4';
        const region = 'us-central1';
        const callbackUrl = `https://${region}-${projectId}.cloudfunctions.net/kopoKopoCallback?orderId=${orderId}`;

        console.log(`📡 Requesting STK Push for Order: ${orderId}, Phone: ${formattedPhone}, Amount: ${amount}`);

        const paymentResponse = await axios.post(`${BASE_URL}/api/v2/incoming_payments`, {
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

        const resourceId = paymentResponse.headers.location ? paymentResponse.headers.location.split('/').pop() : orderId;

        res.json({
            ResponseCode: "0",
            CustomerMessage: "Payment request sent to phone.",
            CheckoutRequestID: resourceId,
            status: "Pending"
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
 * KOPO KOPO CALLBACK HANDLER
 * Processes the asynchronous response from Kopo Kopo.
 */
exports.kopoKopoCallback = functions.https.onRequest(async (req, res) => {
    const payload = req.body;
    // Get orderId from query param or fallback to metadata
    const orderId = req.query.orderId || payload.data?.attributes?.metadata?.order_id;

    console.log(`📥 Received Kopo Kopo Callback for Order: ${orderId}`);

    if (!orderId) {
        console.error('❌ Callback received without Order ID');
        return res.sendStatus(400);
    }

    try {
        const attributes = payload.data?.attributes;
        const status = attributes?.status;

        if (status === 'Success') {
            const resource = attributes.event?.resource || attributes;
            const receipt = resource.reference || resource.system_generate_number || 'N/A';

            console.log(`✅ Payment Success for Order ${orderId}. Receipt: ${receipt}`);

            await admin.database().ref(`orders/${orderId}`).update({
                status: 'Preparing Your Order',
                mpesaReceiptNumber: receipt,
                paidAt: new Date().toISOString(),
                paymentDetails: {
                    resourceId: payload.data.id,
                    amount: attributes.amount?.value
                }
            });
        } else if (status === 'Failed') {
            console.warn(`⚠️ Payment Failed for Order ${orderId}: ${attributes.failure_reason || 'Unknown'}`);
            await admin.database().ref(`orders/${orderId}`).update({
                status: 'Failed',
                failureReason: attributes.failure_reason || 'Payment unsuccessful.'
            });
        } else {
            console.log(`ℹ️ Callback Status: ${status} for Order ${orderId}`);
        }
    } catch (error) {
        console.error('❌ Callback Processing Error:', error.message);
    }

    // Always return 200 to Kopo Kopo to acknowledge receipt
    res.sendStatus(200);
});
