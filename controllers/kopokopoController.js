const axios = require('axios');

/**
 * KOPO KOPO V2 INTEGRATION - MODISH MIX STORE
 *
 * CRITICAL RULES COMPLIANCE:
 * ✔ Always use HTTPS: Enforced via BASE_URL and Render endpoint.
 * ✔ Always use backend: Sensitive credentials (ID/Secret) are never exposed to the frontend.
 * ✔ OAuth2 Token: A fresh token is requested for every STK Push transaction.
 * ✔ Callback URL: Mandatory callback is included in every STK Push payload for status updates.
 */

// Configuration
const BASE_URL = process.env.KOPOKOPO_BASE_URL || 'https://api.kopokopo.com';
const CLIENT_ID = process.env.KOPOKOPO_CLIENT_ID || 'NLWEWv831tup-WOMWOcDgpiIOSwJ4jV1s_U6unHEwfg';
const CLIENT_SECRET = process.env.KOPOKOPO_CLIENT_SECRET || 'ITzJF5mdKR94qGleGgurJjroK5KdF7IWbMBefLtFunw';

// Rule: Till number can be "1234567" or "K000000" (per official V2 spec)
const TILL_NUMBER = process.env.KOPOKOPO_TILL_NUMBER || '3309609';
const DB_URL = process.env.FIREBASE_DB_URL || "https://school-system-a97a4-default-rtdb.firebaseio.com";

// STEP 1: Get Access Token (Helper)
// Rule: Use OAuth token for every request
async function getToken() {
    try {
        const res = await axios.post(`${BASE_URL}/oauth/token`, {
            grant_type: "client_credentials",
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET
        });
        return res.data.access_token;
    } catch (err) {
        console.error("❌ Kopo Kopo Auth Failed:", err.response?.data || err.message);
        throw new Error("Authentication failed with payment gateway.");
    }
}

// STEP 2: STK Push Request (Incoming Payment Request)
exports.stkPush = async (req, res) => {
    const { phoneNumber, amount, orderId, firstName, lastName, email } = req.body;

    try {
        const token = await getToken();

        // Phone Normalization: Kopo Kopo V2 requires E.164 (+254...)
        let phone = phoneNumber.replace(/\D/g, '');
        if (phone.startsWith('0')) phone = '254' + phone.slice(1);
        if (!phone.startsWith('254')) phone = '254' + phone;
        phone = '+' + phone;

        // Rule: Must include callback URL
        const callbackUrl = `${process.env.CALLBACK_URL || 'https://kopokopo-backend.onrender.com/api/callback'}?orderId=${orderId}`;

        console.log(`🚀 Initiating STK Push: Order ${orderId} | Phone ${phone}`);

        const response = await axios.post(
            `${BASE_URL}/api/v2/incoming_payments`,
            {
                payment_channel: "M-PESA",
                till_number: TILL_NUMBER,
                subscriber: {
                    first_name: firstName || "Customer",
                    last_name: lastName || "User",
                    phone_number: phone,
                    email: email || "customer@example.com"
                },
                amount: {
                    currency: "KES",
                    value: amount
                },
                metadata: {
                    order_id: orderId,
                    customer_id: orderId,
                    notes: `Payment for Order ${orderId}`
                },
                _links: {
                    callback_url: callbackUrl
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            }
        );

        // Success response compatible with index.html (checks for ResponseCode: "0")
        res.json({
            success: true,
            ResponseCode: "0",
            message: "STK push initiated",
            CheckoutRequestID: response.headers.location || orderId,
            location: response.headers.location,
            data: response.data
        });

    } catch (err) {
        const errorData = err.response ? err.response.data : err.message;
        console.error('❌ STK Push Failed:', JSON.stringify(errorData, null, 2));
        res.status(500).json({
            success: false,
            error: 'Payment processing failed',
            details: errorData
        });
    }
};

// STEP 3: Handle Callback (Process Incoming Payment Result)
exports.handleCallback = async (req, res) => {
    const { orderId } = req.query;
    const payload = req.body;

    // Reliability: Check metadata if orderId is missing from query string
    const targetOrderId = orderId || payload.data?.attributes?.metadata?.order_id;

    console.log(`\n🔔 Payment Callback Received: Order ${targetOrderId}`);

    try {
        if (!targetOrderId) throw new Error("Missing Order Reference");

        const orderUpdateUrl = `${DB_URL}/orders/${targetOrderId}.json`;
        const attributes = payload.data?.attributes;
        const status = attributes?.status;

        if (status === 'Success') {
            const resource = attributes.event?.resource;
            const receipt = resource?.reference || resource?.system_generate_number;

            console.log(`✅ PAID: Order ${targetOrderId} | Receipt: ${receipt}`);

            await axios.patch(orderUpdateUrl, {
                status: 'Preparing Your Order',
                mpesaReceiptNumber: receipt,
                paidAt: new Date().toISOString()
            });
        } else {
            // Official V2 Failure Handling: Use the errors array from the example provided
            const errors = attributes?.event?.errors;
            const failureReason = (errors && Array.isArray(errors) && errors.length > 0)
                ? errors.join(', ')
                : (attributes?.result_description || 'Transaction unsuccessful');

            console.log(`❌ FAILED: Order ${targetOrderId} | Reason: ${failureReason}`);

            await axios.patch(orderUpdateUrl, {
                status: 'Failed',
                failureReason: failureReason
            });
        }
    } catch (error) {
        console.error('❌ Callback Processing Error:', error.message);
    }

    res.sendStatus(200); // Always acknowledge the callback to Kopo Kopo
};

// STEP 4: Webhook Handler (Buy Goods/Account Events)
exports.webhook = async (req, res) => {
    console.log("🔔 Webhook Received:", JSON.stringify(req.body, null, 2));

    try {
        const attributes = req.body.data?.attributes;
        const orderId = attributes?.metadata?.order_id;

        if (attributes?.status === 'Success' && orderId) {
            console.log(`✅ Webhook: Order ${orderId} verified as PAID`);
            await axios.patch(`${DB_URL}/orders/${orderId}.json`, {
                status: 'Preparing Your Order',
                paidVia: 'Webhook Notification',
                paidAt: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('❌ Webhook Error:', error.message);
    }

    res.sendStatus(200);
};

// STEP 5: Webhook Subscription (Trial/Setup)
exports.subscribeWebhooks = async (req, res) => {
    try {
        const token = await getToken();

        const request_body = {
            event_type: req.body.event_type || "buygoods_transaction_received",
            url: req.body.url || 'https://kopokopo-backend.onrender.com/api/webhook',
            scope: req.body.scope || "till",
            scope_reference: req.body.scope_reference || TILL_NUMBER,
            enable_daraja_payload: req.body.enable_daraja_payload || false
        };

        console.log(`📡 Registering Webhook Subscription: ${request_body.event_type}`);

        const response = await axios.post(
            `${BASE_URL}/api/v2/webhook_subscriptions`,
            request_body,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            success: true,
            message: "Webhook subscription initiated",
            location: response.headers.location,
            data: response.data
        });
    } catch (err) {
        const errorData = err.response ? err.response.data : err.message;
        console.error('❌ Webhook Subscription Failed:', JSON.stringify(errorData, null, 2));
        res.status(500).json({
            success: false,
            error: 'Webhook subscription failed',
            details: errorData
        });
    }
};
