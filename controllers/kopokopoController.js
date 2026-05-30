const axios = require('axios');

const CLIENT_ID = process.env.KOPOKOPO_CLIENT_ID;
const CLIENT_SECRET = process.env.KOPOKOPO_CLIENT_SECRET;
const TILL_NUMBER = process.env.KOPOKOPO_TILL_NUMBER;
const BASE_URL = 'https://api.kopokopo.com';

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

        const callbackUrl = process.env.CALLBACK_URL || `https://your-ngrok-url.ngrok-free.app/callback?orderId=${orderId}`;

        const paymentResponse = await axios.post(`${BASE_URL}/api/v1/incoming_payments`, {
            payment_channel: 'm-mpesa',
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
};

exports.handleCallback = (req, res) => {
    const { orderId } = req.query;
    console.log(`\n🔔 Callback for Order: ${orderId}`);
    console.log(JSON.stringify(req.body, null, 2));
    res.sendStatus(200);
};
