const axios = require('axios');

const CHAPA_API_URL = 'https://api.chapa.co/v1';

function getSecretKey() {
  const secretKey = process.env.CHAPA_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      'CHAPA_SECRET_KEY is not configured in the environment'
    );
  }

  return secretKey;
}

// ============================================================
// INITIALIZE CHAPA PAYMENT
// ============================================================

async function initializeChapaPayment({
  txRef,
  amountEtb,
  email,
  name,
  phoneNumber,
  title = ' Subscription'
}) {
  const secretKey = getSecretKey();

  const backendUrl =
    process.env.BACKEND_URL || 'http://localhost:5000';

  const frontendUrl =
    process.env.FRONTEND_URL || 'http://localhost:3000';

  const callbackUrl =
    `${backendUrl}/api/v1/payments/chapa/callback`;

  const returnUrl =
    `${frontendUrl}/payment-success?tx_ref=${encodeURIComponent(txRef)}`;

  const nameParts = String(name || 'EthioNutri User')
      .trim()
      .split(/\s+/);

  const firstName = nameParts[0] || 'User';

  const lastName =
      nameParts.slice(1).join(' ') || 'EthioNutri';

  const payload = {
    amount: String(amountEtb),
    currency: 'ETB',

    email,

    first_name: firstName,
    last_name: lastName,

    tx_ref: txRef,

    callback_url: callbackUrl,
    return_url: returnUrl,

    customization: {
      title,
      description:
        'Unlimted'
    },

    meta: {
      payment_reason:
        'Subscription'
    }
  };

  if (phoneNumber) {
    payload.phone_number = phoneNumber;
  }

  try {
    console.log('Initializing Chapa payment:', {
      txRef,
      amountEtb,
      email,
      returnUrl,
      callbackUrl
    });

    const response = await axios.post(
      `${CHAPA_API_URL}/transaction/initialize`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log(
      'Chapa initialize response:',
      response.data
    );

    if (
      response.data?.status !== 'success' ||
      !response.data?.data?.checkout_url
    ) {
      throw new Error(
        response.data?.message ||
        'Chapa did not return a checkout URL'
      );
    }

    return {
      status: 'success',
      isSimulation: false,
      checkoutUrl: response.data.data.checkout_url,
      txRef,
      raw: response.data
    };

} catch (err) {
  console.error('\n========== CHAPA INITIALIZATION ERROR ==========');

  console.error('Error message:', err.message);
  console.error('Error code:', err.code);

  if (err.response) {
    console.error('HTTP status:', err.response.status);
    console.error(
      'Chapa response:',
      JSON.stringify(err.response.data, null, 2)
    );
    console.error('Response headers:', err.response.headers);
  } else if (err.request) {
    console.error('Request was sent, but Chapa gave no response.');
    console.error('Request:', err.request);
  } else {
    console.error('Axios/setup error:', err);
  }

  console.error('===============================================\n');

  const chapaData = err.response?.data;

  let errorMessage = 'Failed to initialize Chapa payment';

  if (typeof chapaData === 'string') {
    errorMessage = chapaData;
  } else if (chapaData?.message) {
    errorMessage = chapaData.message;
  } else if (chapaData?.error) {
    errorMessage =
      typeof chapaData.error === 'string'
        ? chapaData.error
        : JSON.stringify(chapaData.error);
  } else if (err.message) {
    errorMessage = err.message;
  }

  throw new Error(errorMessage);
}

}

// ============================================================
// VERIFY PAYMENT
// ============================================================

async function verifyChapaPayment(txRef) {
  const secretKey = getSecretKey();

  try {
    console.log(
      `Verifying Chapa transaction: ${txRef}`
    );

    const response = await axios.get(
      `${CHAPA_API_URL}/transaction/verify/${encodeURIComponent(txRef)}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`
        },
        timeout: 15000
      }
    );

    console.log(
      'Chapa verification response:',
      response.data
    );

    const data = response.data?.data;

    if (!data) {
      return {
        verified: false,
        txRef,
        status: 'failed'
      };
    }

    return {
      verified: data.status === 'success',
      txRef,
      status: data.status,
      data
    };

  } catch (err) {
    console.error(
      'CHAPA VERIFICATION FAILED:',
      err.response?.data || err.message
    );

    throw new Error(
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.message ||
      'Failed to verify Chapa payment'
    );
  }
}

module.exports = {
  initializeChapaPayment,
  verifyChapaPayment
};