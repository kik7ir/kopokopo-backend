const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const options = {
    clientId: functions.config().kopo.client_id,
    clientSecret: functions.config().kopo.client_secret,
    baseUrl: functions.config().kopo.base_url,
    apiKey: functions.config().kopo.api_key
};

const K2 = require("k2-connect-node")(options);
const StkService = K2.StkService;
const TokenService = K2.TokenService;
const Webhooks = K2.Webhooks;

exports.initiateSTK = functions.https.onCall(async (data, context) => {
    // Basic validation
    if (!data.phoneNumber || !data.amount) {
        throw new functions.https.HttpsError('invalid-argument', 'Phone number and amount are required.');
    }

    try {
        const tokenResponse = await TokenService.getToken();
        const accessToken = tokenResponse.access_token;

        const stkOptions = {
            tillNumber: functions.config().kopo.till_number,
            firstName: data.firstName || 'Customer',
            lastName: data.lastName || '',
            phoneNumber: data.phoneNumber,
            amount: data.amount,
            currency: 'KES',
            callbackUrl: `https://${process.env.GCLOUD_PROJECT}.cloudfunctions.net/kopoWebhook`,
            accessToken: accessToken,
            metadata: {
                orderId: data.orderId || 'N/A',
                customerId: context.auth ? context.auth.uid : 'anonymous'
            }
        };

        const response = await StkService.initiateIncomingPayment(stkOptions);

        // Save the request to database for tracking
        await admin.database().ref(`payments/${data.orderId}`).set({
            status: 'pending',
            location: response,
            phoneNumber: data.phoneNumber,
            amount: data.amount,
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        return { success: true, location: response };
    } catch (error) {
        console.error('STK Error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to initiate STK push');
    }
});

exports.kopoWebhook = functions.https.onRequest(async (req, res) => {
    try {
        const payload = req.body;
        console.log('Kopo Webhook Received:', JSON.stringify(payload));

        // Note: SDK's webhookHandler might expect req/res and handle response
        // Using manual handling to ensure integration with Firebase Database

        const eventType = payload.event.type;
        const resource = payload.event.resource;
        const metadata = resource.metadata || {};
        const orderId = metadata.orderId;

        if (orderId) {
            let status = 'failed';
            if (payload.event.type === 'buygoods_transaction_received' || resource.status === 'Success') {
                status = 'completed';
            }

            await admin.database().ref(`payments/${orderId}`).update({
                status: status,
                kopoResponse: payload,
                updatedAt: admin.database.ServerValue.TIMESTAMP
            });

            // If completed, maybe update the order status too
            if (status === 'completed') {
                await admin.database().ref(`orders/${orderId}`).update({
                    paymentStatus: 'paid',
                    status: 'processing'
                });
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).send('Internal Server Error');
    }
});
