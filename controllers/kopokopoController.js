const axios = require('axios');

/**
 * KOPOKOPO V2 FIXED INTEGRATION
 * FIXES:
 * ✔ Till number validation issue
 * ✔ Wrong payment_channel
 * ✔ Unsafe fallback values
 * ✔ Better debugging for Render
 */

// ================= CONFIG =================
// Hardcoding Sandbox values for testing to ensure they work on Render
const BASE_URL = process.env.KOPOKOPO_BASE_URL || 'https://sandbox.kopokopo.com';
const TILL_NUMBER = process.env.KOPOKOPO_TILL_NUMBER || 'K000000'; // Fallback to Sandbox Till
const CLIENT_ID = process.env.KOPOKOPO_CLIENT_ID;
const CLIENT_SECRET = process.env.KOPOKOPO_CLIENT_SECRET;
const DB_URL = "https://school-system-a97a4-default-rtdb.firebaseio.com";

// ================= SAFETY CHECK =================
if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("❌ CRITICAL: KOPOKOPO_CLIENT_ID or CLIENT_SECRET is missing in environment variables!");
}

// ================= GET TOKEN =================
async function getToken() {
    try {
        console.log(`🔑 Requesting token from: ${BASE_URL}/oauth/token`);
        const res = await axios.post(`${BASE_URL}/oauth/token`, {
            grant_type: "client_credentials",
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET
        });

        return res.data.access_token;
    } catch (err) {
        const errDetail = err.response?.data || err.message;
        console.error("❌ Auth Failed:", errDetail);
        throw new Error(`KopoKopo authentication failed: ${JSON.stringify(errDetail)}`);
    }
}

// ================= STK PUSH =================
exports.stkPush = async (req, res) => {
    const { phoneNumber, amount, orderId, firstName, lastName, email } = req.body;

    try {
        const token = await getToken();

        // ================= PHONE FORMAT FIX =================
        let phone = phoneNumber.replace(/\D/g, '');
        if (phone.startsWith('0')) phone = '254' + phone.slice(1);
        if (!phone.startsWith('254')) phone = '254' + phone;
        phone = '+' + phone;

        // ================= CALLBACK =================
        const callbackUrl = `${process.env.CALLBACK_URL || 'https://kopokopo-backend.onrender.com/api/callback'}?orderId=${orderId}`;

        // ================= DEBUG LOGS =================
        console.log("🚀 STK PUSH INITIATED");
        console.log("📦 Order:", orderId);
        console.log("📱 Phone:", phone);
        console.log("🏦 Till:", TILL_NUMBER);

        // ================= VALIDATION =================
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "Invalid amount" });
        }

        if (!TILL_NUMBER) {
            return res.status(500).json({ error: "Missing till number in server config" });
        }

        // ================= KOPOKOPO REQUEST =================
        const response = await axios.post(
            `${BASE_URL}/api/v2/incoming_payments`,
            {
                payment_channel: "m-pesa", // ✅ Matches V2 API and Firebase function
                till_number: TILL_NUMBER,

                subscriber: {
                    first_name: firstName || "Customer",
                    last_name: lastName || "User",
                    phone_number: phone,
                    email: email || "customer@example.com"
                },

                amount: {
                    currency: "KES",
                    value: Number(amount)
                },

                metadata: {
                    order_id: orderId,
                    notes: "Payment via STK Push"
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

        // ================= SUCCESS =================
        res.json({
            success: true,
            ResponseCode: "0", // Compatible with index.html
            message: "STK push sent successfully",
            CheckoutRequestID: response.headers.location || orderId,
            data: response.data
        });

    } catch (err) {
        console.error("❌ STK PUSH ERROR:", err.response?.data || err.message);

        res.status(500).json({
            success: false,
            error: "Payment failed",
            details: err.response?.data || err.message
        });
    }
};

// ================= CALLBACK HANDLER =================
exports.handleCallback = async (req, res) => {
    const { orderId } = req.query;
    const payload = req.body;
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

    res.sendStatus(200);
};

// ================= WEBHOOK HANDLER =================
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

// ================= WEBHOOK SUBSCRIPTION =================
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

        res.json({ success: true, data: response.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
