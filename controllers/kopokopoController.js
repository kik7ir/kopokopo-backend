const axios = require('axios');

// Configuration
const BASE_URL = process.env.KOPOKOPO_BASE_URL || 'https://api.kopokopo.com';
const CLIENT_ID = process.env.KOPOKOPO_CLIENT_ID || 'NLWEWv831tup-WOMWOcDgpiIOSwJ4jV1s_U6unHEwfg';
const CLIENT_SECRET = process.env.KOPOKOPO_CLIENT_SECRET || 'ITzJF5mdKR94qGleGgurJjroK5KdF7IWbMBefLtFunw';
const TILL_NUMBER = process.env.KOPOKOPO_TILL_NUMBER || '3309609';

// STEP 1: Get Access Token (Helper)
async function getToken() {
    const res = await axios.post(`${BASE_URL}/oauth/token`, {
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
    });
    return res.data.access_token;
}

// STEP 2: STK Push Request (Button Trigger)
exports.stkPush = async (req, res) => {
    const { phoneNumber, amount, orderId, firstName, lastName, email } = req.body;

    try {
        const token = await getToken();

        // Ensure E.164 formatting for Kopo Kopo V2 (+254...)
        let phone = phoneNumber.replace(/\D/g, '');
        if (phone.startsWith('0')) phone = '254' + phone.slice(1);
        if (!phone.startsWith('254')) phone = '254' + phone;
        phone = '+' + phone;

        const response = await axios.post(
            `${BASE_URL}/api/v2/incoming_payments`,
            {
                payment_channel: "M-PESA STK Push",
                till_number: TILL_NUMBER,
                subscriber: {
                    first_name: firstName || "Customer",
                    last_name: lastName || "Name",
                    phone_number: phone,
                    email: email || "customer@example.com"
                },
                amount: {
                    currency: "KES",
                    value: amount
                },
                metadata: {
                    order_id: orderId
                },
                _links: {
                    callback_url: `${process.env.CALLBACK_URL || 'https://kopokopo-backend.onrender.com/api/callback'}?orderId=${orderId}`
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
            message: "STK push sent",
            CheckoutRequestID: response.headers.location || orderId,
            data: response.data
        });

    } catch (err) {
        const errorData = err.response ? err.response.data : err.message;
        console.error('❌ Kopo Kopo Error:', JSON.stringify(errorData, null, 2));
        res.status(500).json({
            success: false,
            error: 'Payment failed',
            details: errorData
        });
    }
};

// STEP 3: Handle Callback
exports.handleCallback = async (req, res) => {
    const { orderId } = req.query;
    const payload = req.body;

    console.log(`\n🔔 Kopo Kopo Callback Received for Order: ${orderId}`);
    // console.log(JSON.stringify(payload, null, 2));

    try {
        const DB_URL = "https://school-system-a97a4-default-rtdb.firebaseio.com";
        const orderUpdateUrl = `${DB_URL}/orders/${orderId}.json`;

        // Kopo Kopo V2 structure: payload.data.attributes.status
        const status = payload.data?.attributes?.status;

        if (status === 'Success') {
            const event = payload.data.attributes.event;
            const resource = event.resource;
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
                failureReason: payload.data?.attributes?.result_description || 'Payment was unsuccessful.'
            });
        }
    } catch (error) {
        console.error('❌ Callback Processing Error:', error.message);
    }

    res.sendStatus(200);
};
