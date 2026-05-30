const axios = require('axios');

// Set this to 'https://api.kopokopo.com' for Production or 'https://sandbox.kopokopo.com' for Testing
const BASE_URL = process.env.KOPOKOPO_BASE_URL || 'https://api.kopokopo.com';
const CLIENT_ID = process.env.KOPOKOPO_CLIENT_ID || 'NLWEWv831tup-WOMWOcDgpiIOSwJ4jV1s_U6unHEwfg';
const CLIENT_SECRET = process.env.KOPOKOPO_CLIENT_SECRET || 'ITzJF5mdKR94qGleGgurJjroK5KdF7IWbMBefLtFunw';
const TILL_NUMBER = process.env.KOPOKOPO_TILL_NUMBER || '3309609';

exports.stkPush = async (req, res) => {
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

        const baseCallbackUrl = process.env.CALLBACK_URL || 'https://kopokopo-backend.onrender.com/api/callback';
        const callbackUrl = `${baseCallbackUrl}?orderId=${orderId}`;

        const paymentPayload = {
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
        };

        console.log('🚀 Sending to Kopo Kopo:', JSON.stringify({ ...paymentPayload, till_number: TILL_NUMBER }, null, 2));

        const paymentResponse = await axios.post(`${BASE_URL}/api/v1/incoming_payments`, paymentPayload, {
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
        const errorData = error.response ? error.response.data : error.message;
        console.error('❌ Kopo Kopo Error:', errorData);
        res.status(500).json({
            error: 'Request Failed',
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
