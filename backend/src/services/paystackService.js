const axios = require("axios");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function client() {
  return axios.create({
    baseURL: PAYSTACK_BASE_URL,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
}

/**
 * Initialize a transaction with Paystack. Amount must be in kobo.
 * Returns the authorization_url + access_code + reference, which the
 * frontend uses to launch Paystack Inline (or redirect, as a fallback).
 */
async function initializeTransaction({ email, amountKobo, reference, metadata }) {
  const { data } = await client().post("/transaction/initialize", {
    email,
    amount: amountKobo,
    reference,
    metadata,
    channels: ["card", "bank", "ussd", "bank_transfer", "mobile_money"],
  });
  return data.data; // { authorization_url, access_code, reference }
}

/**
 * Verify a transaction server-side. This is the ONLY source of truth
 * for whether a payment actually succeeded — never trust a "success"
 * message coming from the browser, since that can be faked by anyone
 * who opens devtools and calls the success callback manually.
 */
async function verifyTransaction(reference) {
  const { data } = await client().get(`/transaction/verify/${encodeURIComponent(reference)}`);
  return data.data; // includes status, amount, currency, customer, metadata, etc.
}

module.exports = { initializeTransaction, verifyTransaction };
