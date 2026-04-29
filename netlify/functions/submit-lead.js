// Netlify serverless function: submit-lead
// Receives form data from the Village Hub interest form
// and submits it to Zoho CRM via the Web-to-Lead endpoint.
exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
          return { statusCode: 405, body: 'Method Not Allowed' };
    }
    try {
          // Parse incoming form data
      const params = new URLSearchParams(event.body);
          const firstName     = params.get('first_name') || '';
          const lastName      = params.get('last_name') || '';
          const email         = params.get('email') || '';
          const phone         = params.get('phone') || '';
          const company       = params.get('company') || '';
          const planInterest  = params.get('plan_interest') || '';
          const preferredDate = params.get('preferred_date') || '';
          const description   = params.get('description') || '';
          const leadSource    = params.get('lead_source') || 'Website - Interest Form';

      // Build full description for Zoho
      const fullDescription = [
              planInterest  ? `Plan Interest: ${planInterest}` : '',
              preferredDate ? `Preferred Visit Date: ${preferredDate}` : '',
              description
            ].filter(Boolean).join('\n\n');

      const zohoPayload = new URLSearchParams({
              xnQsjsdp: '3bab74f7e8aba6be99b9d1863cff751310a973b2c6f80cb471b7a4eede332658',
              xmIwtLD: 'bdb9fc7c567f2c2566b234583069f587376dc60a5539756d51c3e410227569ad393d23a4d15100a62a79b7c7a7284819',
              actionType: 'TGVhZHM=',
              returnURL: 'https://the-village-hub.netlify.app/success.html',
              'First Name':  firstName,
              'Last Name':   lastName,
              'Email':       email,
              'Phone':       phone,
              'Company':     company,
              'Description': fullDescription,
              'Lead Source': leadSource,
      });

      const zohoRes = await fetch('https://crm.zoho.com/crm/WebToLeadForm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: zohoPayload.toString(),
              redirect: 'manual',
      });

      if (zohoRes.ok || zohoRes.status === 302 || zohoRes.status === 301 || zohoRes.redirected) {
              return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
      }
          const responseText = await zohoRes.text();
          console.error('Zoho responded with status:', zohoRes.status, responseText.slice(0, 200));
          return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Zoho submission failed' }) };
    } catch (err) {
          console.error('submit-lead error:', err);
          return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: err.message }) };
    }
};
