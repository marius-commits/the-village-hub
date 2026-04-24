// Netlify serverless function: submit-lead
// Receives form data from the Village Hub Free Day Pass form
// and submits it to Zoho CRM via the Web-to-Lead endpoint.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parse incoming form data
    const params = new URLSearchParams(event.body);
    const firstName  = params.get('first_name') || '';
    const lastName   = params.get('last_name') || '';
    const email      = params.get('email') || '';
    const phone      = params.get('phone') || '';
    const planInterest = params.get('plan_interest') || '';
    const description  = params.get('description') || '';

    // Build Zoho Web-to-Lead payload
    // Hidden security tokens from the Zoho Web Form "Village Hub Free Day Pass"
    const zohoPayload = new URLSearchParams({
      xnQsjsdp:  '3bab74f7e8aba6be99b9d1863cff751310a973b2c6f80cb471b7a4eede332658',
      xmIwtLD:   'bdb9fc7c567f2c2566b234583069f587376dc60a5539756d51c3e410227569ad393d23a4d15100a62a79b7c7a7284819',
      actionType: 'TGVhZHM=',
      returnURL:  'https://the-village-hub.netlify.app/success.html',
      'First Name': firstName,
      'Last Name':  lastName,
      'Email':      email,
      'Phone':      phone,
      'Description': `Plan Interest: ${planInterest}\n\n${description}`,
      'Lead Source': 'Website - Free Day Pass',
    });

    const zohoRes = await fetch('https://crm.zoho.com/crm/WebToLeadForm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: zohoPayload.toString(),
    });

    // Zoho Web-to-Lead always returns 200 with a redirect; treat any 2xx/3xx as success
    if (zohoRes.ok || zohoRes.status === 302 || zohoRes.redirected) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      };
    }

    console.error('Zoho responded with status:', zohoRes.status);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Zoho submission failed' }),
    };

  } catch (err) {
    console.error('submit-lead error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
