const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const API_URL = process.env.SMARTPAY_API_URL || 'https://api.smartpaypesa.com/v1/stk/push';
const API_KEY = process.env.SMARTPAY_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure rate-limiter: Max 30 requests per 60,000ms (1 request per 2 seconds)
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 2000
});

// Helper function to format Kenyan numbers (e.g., 0712345678 or +254712345678 -> 254712345678)
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}

// Function to call SmartPay Pesa API
async function sendStkPush(phone, amount, accountReference) {
  const formattedPhone = formatPhoneNumber(phone);
  
  if (!/^254(7|1)\d{8}$/.test(formattedPhone)) {
    throw new Error(`Invalid Kenyan phone number format: ${phone}`);
  }

  const payload = {
    phone: formattedPhone,
    amount: Number(amount),
    account_reference: accountReference
  };

  const response = await axios.post(API_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    timeout: 10000
  });

  return response.data;
}

// Wrap function with Bottleneck limiter
const wrappedSendStkPush = limiter.wrap(sendStkPush);

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Dashboard client connected:', socket.id);

  socket.on('start-bulk-push', async (data) => {
    const { rawNumbers, amount, reference } = data;
    
    // Parse lines/commas into distinct clean entries
    const numbers = rawNumbers
      .split(/[\n,]+/)
      .map(n => n.trim())
      .filter(n => n.length > 0);

    socket.emit('bulk-started', { total: numbers.length });

    for (let i = 0; i < numbers.length; i++) {
      const phone = numbers[i];
      const currentRef = `${reference}_${i + 1}`;

      try {
        const result = await wrappedSendStkPush(phone, amount, currentRef);
        socket.emit('job-progress', {
          index: i + 1,
          total: numbers.length,
          phone,
          status: 'SUCCESS',
          details: result?.message || 'STK Push dispatched successfully'
        });
      } catch (err) {
        socket.emit('job-progress', {
          index: i + 1,
          total: numbers.length,
          phone,
          status: 'FAILED',
          details: err.response?.data?.message || err.message || 'API request failed'
        });
      }
    }

    socket.emit('bulk-completed');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
