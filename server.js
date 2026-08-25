const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SMARTPAY_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to enforce rate limiting delay (5 requests per minute = 1 request every 12 seconds)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post('/api/bulk-stk', async (req, res) => {
  const { phones, amount, account_reference, description } = req.body;

  if (!phones || !Array.isArray(phones) || phones.length === 0) {
    return res.status(400).json({ error: 'At least one phone number is required.' });
  }

  if (!amount || amount < 1 || amount > 300000) {
    return res.status(400).json({ error: 'Amount must be between 1 and 300,000 KES.' });
  }

  // Set response headers to stream live progress updates to client
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const DELAY_MS = 12000; // 12 seconds = 5 req/min

  for (let i = 0; i < phones.length; i++) {
    const phone = phones[i].trim();
    if (!phone) continue;

    const payload = {
      phone,
      amount: parseInt(amount, 10),
      account_reference: account_reference || 'SMARTPAY',
      description: description || 'SmartPay Payment'
    };

    let logResult = { phone, timestamp: new Date().toLocaleTimeString() };

    try {
      const response = await axios.post(
        'https://api.smartpaypesa.com/v1/stk/push',
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
          }
        }
      );

      logResult.status = 'SUCCESS';
      logResult.data = response.data;
    } catch (error) {
      logResult.status = 'FAILED';
      logResult.data = error.response ? error.response.data : error.message;
    }

    // Push SSE update to browser UI
    res.write(`data: ${JSON.stringify(logResult)}\n\n`);

    // Wait 12s before processing next record (except on last iteration)
    if (i < phones.length - 1) {
      await delay(DELAY_MS);
    }
  }

  res.write(`data: ${JSON.stringify({ status: 'COMPLETE' })}\n\n`);
  res.end();
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
