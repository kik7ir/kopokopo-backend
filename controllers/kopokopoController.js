const axios = require('axios');

const BASE_URL = process.env.KOPOKOPO_BASE_URL || 'https://api.kopokopo.com';
const CLIENT_ID = process.env.KOPOKOPO_CLIENT_ID || 'NLWEWv831tup-WOMWOcDgpiIOSwJ4jV1s_U6unHEwfg';
const CLIENT_SECRET = process.env.KOPOKOPO_CLIENT_SECRET || 'ITzJF5mdKR94qGleGgurJjroK5KdF7IWbMBefLtFunw';
const API_KEY = process.env.KOPOKOPO_API_KEY;
const TILL_NUMBER = process.env.KOPOKOPO_TILL_NUMBER || '3309609';

exports.stkPush = async (req, res) => {
    const { phoneNumber, amount, orderId, firstName, lastName } = req.body;

    try {
        // 1. Get Access Token
        console.log('🔑 Requesting Access Token...');
        const tokenResp = await axios.post(`${BASE_URL}/oauth/token`, {
            grant_type: 'client_credentials',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET
        });
        const accessToken = tokenResp.data.access_token;

        // 2. Format Phone (must be 254...)
        let formattedPhone = phoneNumber.replace(/\D/g, '');
        if (!formattedPhone.startsWith('254')) {
            if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);
            else formattedPhone = '254' + formattedPhone;
        }

        const baseCallbackUrl = process.env.CALLBACK_URL || 'https://kopokopo-backend.onrender.com/api/callback';
        const callbackUrl = `${baseCallbackUrl}?orderId=${orderId}`;

        // 3. Create Payment (Matches your example exactly)
        const paymentPayload = {
            phone_number: formattedPhone,
            currency: 'KES',
            amount: amount,
            description: `Order #${orderId} - ${firstName} ${lastName}`,
            callback_url: callbackUrl
        };

        console.log('🚀 Sending to Kopo Kopo /payments:', JSON.stringify(paymentPayload, null, 2));

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        // Add X-Api-Key if provided (Required by some Kopo Kopo versions)
        if (API_KEY) {
            headers['X-Api-Key'] = API_KEY;
        }

        const response = await axios.post(`${BASE_URL}/payments`, paymentPayload, { headers });

        console.log('✅ Kopo Kopo Response:', response.data);

        // Return response format expected by index.html
        res.json({
            ResponseCode: "0",
            CustomerMessage: "Payment request sent to phone.",
            CheckoutRequestID: response.headers.location || orderId,
            raw: response.data
        });

    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error('❌ Kopo Kopo Error:', JSON.stringify(errorData, null, 2));
        res.status(500).json({
            error: 'Payment failed',
            details: errorData
        });
    }
};

exports.handleCallback = (req, res) => {
    const { orderId } = req.query;
    console.log(`\n🔔 Callback for Order: ${orderId}`);
    console.log(JSON.stringify(req.body, null, 2));
    res.sendStatus(200);
};
