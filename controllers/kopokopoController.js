const K2 = require("k2-connect-node")({
    clientId: process.env.KOPOKOPO_CLIENT_ID,
    clientSecret: process.env.KOPOKOPO_CLIENT_SECRET,
    apiKey: process.env.KOPOKOPO_API_KEY,
    baseUrl: process.env.KOPOKOPO_BASE_URL || 'https://sandbox.kopokopo.com'
});

const TokenService = K2.TokenService;
const StkService = K2.StkService;
const DB_URL = "https://school-system-a97a4-default-rtdb.firebaseio.com";
const axios = require('axios');

// ================= STK PUSH =================
exports.stkPush = async (req, res) => {
    const { phoneNumber, amount, orderId, firstName, lastName, email } = req.body;

    try {
        console.log(`🚀 K2 SDK: Initiating payment for ${orderId}`);

        // 1. Get Token using SDK
        const tokenResponse = await TokenService.getToken();
        const accessToken = tokenResponse.access_token;

        // 2. Format Phone (SDK expects +254...)
        let phone = phoneNumber.replace(/\D/g, '');
        if (phone.startsWith('0')) phone = '254' + phone.slice(1);
        if (!phone.startsWith('254')) phone = '254' + phone;
        phone = '+' + phone;

        // 3. Initiate STK Push using SDK
        const stkResponse = await StkService.initiateIncomingPayment({
            tillNumber: process.env.KOPOKOPO_TILL_NUMBER || "K000000",
            firstName: firstName || "Customer",
            lastName: lastName || "User",
            phoneNumber: phone,
            amount: amount,
            currency: "KES",
            email: email || "customer@example.com",
            callbackUrl: `${process.env.CALLBACK_URL || 'https://kopokopo-backend.onrender.com/api/callback'}?orderId=${orderId}`,
            paymentChannel: "M-PESA STK Push",
            accessToken: accessToken,
            metadata: {
                orderId: orderId,
                notes: "Payment for Order " + orderId
            }
        });

        console.log("✅ K2 SDK Response:", stkResponse);

        res.json({
            success: true,
            ResponseCode: "0", // Keeping compatibility with frontend
            message: "STK push sent successfully",
            location: stkResponse,
            CheckoutRequestID: orderId // Using OrderId as fallback reference
        });

    } catch (err) {
        console.error("❌ K2 SDK ERROR:", err.message);
        res.status(500).json({
            success: false,
            error: "Payment failed",
            details: err.message
        });
    }
};

// ================= CALLBACK HANDLER =================
exports.handleCallback = async (req, res) => {
    const { orderId } = req.query;
    const payload = req.body;

    // SDK Webhook/Callback payload structure
    const attributes = payload.data?.attributes;
    const targetOrderId = orderId || attributes?.metadata?.order_id;

    console.log(`\n🔔 K2 Callback: Order ${targetOrderId} | Status: ${attributes?.status}`);

    try {
        if (!targetOrderId) throw new Error("Missing Order Reference");

        const orderUpdateUrl = `${DB_URL}/orders/${targetOrderId}.json`;

        if (attributes?.status === 'Success') {
            const resource = attributes.event?.resource;
            const receipt = resource?.reference || resource?.system_generate_number;

            await axios.patch(orderUpdateUrl, {
                status: 'Preparing Your Order',
                mpesaReceiptNumber: receipt,
                paidAt: new Date().toISOString()
            });
        } else {
            await axios.patch(orderUpdateUrl, {
                status: 'Failed',
                failureReason: attributes?.result_description || 'Transaction unsuccessful'
            });
        }
    } catch (error) {
        console.error('❌ Callback Processing Error:', error.message);
    }

    res.status(200).send("OK");
};

// ================= WEBHOOKS =================
exports.webhook = async (req, res) => {
    console.log("🔔 Webhook Received:", JSON.stringify(req.body, null, 2));
    res.status(200).send("OK");
};

exports.subscribeWebhooks = async (req, res) => {
    try {
        const tokenResponse = await TokenService.getToken();
        const response = await K2.Webhooks.subscribe({
            eventType: 'buygoods_transaction_received',
            url: 'https://kopokopo-backend.onrender.com/api/webhook',
            scope: 'till',
            scopeReference: process.env.KOPOKOPO_TILL_NUMBER || "K000000",
            accessToken: tokenResponse.access_token
        });
        res.json({ success: true, data: response });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
