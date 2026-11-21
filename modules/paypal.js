const axios = require('axios');
const fs = require('fs');
const path = require('path');
const soundPlayer = require('../utils/soundPlayer');
const { triggerDonationAlert } = require('../alerts/server');
const configLoader = require('./configLoader');
const alertServerConfig = require('./alertServerConfig');
const branding = configLoader.load('branding');

const PAYPAL_REPORTING_DELAY_MS = 6 * 60 * 60 * 1000;

class PayPalMonitor {
    constructor(twitchBot) {
        // Load PayPal config from separate file
        this.config = configLoader.load('paypal');
        this.twitchBot = twitchBot;
        this.lastCheck = new Date();
        this.transactionsFile = path.join(__dirname, '..', 'data', 'paypal_transactions.json');
        this.transactions = this.loadTransactions();
        this.isStreaming = false;
        this.streamStartTime = null;
        this.interval = null; // Will be set when streaming starts
        
        // Create data directory if it doesn't exist
        if (!fs.existsSync(path.dirname(this.transactionsFile))) {
            fs.mkdirSync(path.dirname(this.transactionsFile), { recursive: true });
        }
    }

    loadTransactions() {
        try {
            if (fs.existsSync(this.transactionsFile)) {
                return JSON.parse(fs.readFileSync(this.transactionsFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading PayPal transactions:', error);
        }
        return [];
    }

    saveTransactions() {
        try {
            fs.writeFileSync(this.transactionsFile, JSON.stringify(this.transactions, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving PayPal transactions:', error);
        }
    }

    async getAccessToken() {
        try {
            if (!this.config.clientId || !this.config.secret) {
                console.error('PayPal client ID or secret is missing in config');
                return null;
            }

            // Use sandbox if sandbox flag is set in config
            const isSandbox = this.config.sandbox || false;
            const baseUrl = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
            
            const auth = Buffer.from(`${this.config.clientId}:${this.config.secret}`).toString('base64');
            const response = await axios.post(
                `${baseUrl}/v1/oauth2/token`,
                'grant_type=client_credentials',
                {
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json',
                        'Accept-Language': 'en_US'
                    }
                }
            );
            
            if (response.data && response.data.access_token) {
                return response.data.access_token;
            } else {
                console.error('Invalid response from PayPal auth endpoint:', response.data);
                return null;
            }
        } catch (error) {
            console.error('Error getting PayPal access token:', error.response?.data || error.message);
            return null;
        }
    }

    async checkForNewTransactions() {
        if (!this.isStreaming) {
            return;
        }

        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            console.error('Failed to get PayPal access token');
            return;
        }

        try {
            const now = new Date();
            const reportEndDate = new Date(now.getTime() - PAYPAL_REPORTING_DELAY_MS);
            let startDate = new Date((this.lastCheck || this.streamStartTime || reportEndDate).getTime());
            if (startDate > reportEndDate) {
                startDate = new Date(reportEndDate);
            }

            // If lastCheck is too far in the past (more than 3 days), limit it to 3 days ago
            const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
            if (startDate < threeDaysAgo) {
                startDate = threeDaysAgo;
            }

            // Add a small buffer to avoid missing transactions
            startDate = new Date(Math.max(startDate.getTime() - 5 * 60 * 1000, threeDaysAgo.getTime()));

            // Use sandbox if sandbox flag is set in config
            const isSandbox = this.config.sandbox || false;
            const baseUrl = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

            const response = await axios.get(
                `${baseUrl}/v1/reporting/transactions`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Accept-Language': 'en_US'
                    },
                    params: {
                        start_date: startDate.toISOString(),
                        end_date: reportEndDate.toISOString(),
                        fields: 'transaction_info,payer_info',
                        page_size: 10,
                        transaction_status: 'S'
                    }
                }
            );

            const responseData = response.data;
            const newTransactions = responseData.transaction_details || [];
            const newDonations = [];

            for (const tx of newTransactions) {
                try {
                    const txInfo = tx.transaction_info || {};
                    const payerInfo = tx.payer_info || {};
                    const txId = txInfo.transaction_id;

                    if (!txId) {
                        continue;
                    }

                    if (this.transactions.includes(txId)) {
                        continue;
                    }

                    const amount = txInfo.transaction_amount?.value;
                    const currency = txInfo.transaction_amount?.currency_code || 'USD';
                    const name = payerInfo.payer_name?.given_name ||
                               payerInfo.email_address?.split('@')[0] ||
                               'Anonymous';

                    if (amount && parseFloat(amount) > 0) {
                        newDonations.push({
                            id: txId,
                            amount: parseFloat(amount),
                            currency,
                            name,
                            message: 'Thank you for your support!',
                            timestamp: txInfo.transaction_initiation_date || new Date().toISOString()
                        });

                        this.transactions.push(txId);
                    }
                } catch (txError) {
                    console.error('Error processing transaction:', txError);
                }
            }

            if (newDonations.length > 0) {
                this.saveTransactions();

                for (const donation of newDonations) {
                    try {
                        await this.announceDonation(donation);
                    } catch (announceError) {
                        console.error('Error announcing donation:', announceError);
                    }
                }
            }

            this.lastCheck = reportEndDate;

        } catch (error) {
            console.error('Error checking PayPal transactions:', error.response?.data || error.message);
        }
    }

    async announceDonation(donation) {
        if (!donation || typeof donation !== 'object') {
            console.error('Invalid donation object:', donation);
            return;
        }

        try {
            const donationData = {
                name: donation.name || 'Anonymous',
                amount: donation.amount || '0.00',
                currency: donation.currency || 'USD',
                message: donation.message || 'Thank you for your support!'
            };

            let alertForwarded = false;
            try {
                const alertServerUrl = alertServerConfig.baseUrl;
                await axios.post(`${alertServerUrl}/api/donation`, donationData, { timeout: 5000 });
                alertForwarded = true;
            } catch (error) {
                // Ignore alert server availability noise; only actual errors should be logged.
            }

            if (!alertForwarded && typeof triggerDonationAlert === 'function') {
                try {
                    triggerDonationAlert(donationData);
                } catch (error) {
                    console.error('Error triggering visual alert:', error);
                }
            }

            if (this.twitchBot && this.twitchBot.client) {
                try {
                    let channels = [];

                    if (Array.isArray(this.config.channels) && this.config.channels.length > 0) {
                        channels = this.config.channels;
                    } else if (Array.isArray(this.twitchBot.client.channels) && this.twitchBot.client.channels.length > 0) {
                        channels = this.twitchBot.client.channels;
                    } else if (this.twitchBot.config && Array.isArray(this.twitchBot.config.twitch_channel)) {
                        channels = this.twitchBot.config.twitch_channel.map(ch => ch.startsWith('#') ? ch : `#${ch}`);
                    } else {
                        return;
                    }

                    const message = this.config.message
                        ? this.config.message
                            .replace(/{name}/g, donationData.name)
                            .replace(/{amount}/g, donationData.amount)
                            .replace(/{currency}/g, donationData.currency)
                        : `🎉 Thank you ${donationData.name} for the ${donationData.amount} ${donationData.currency} donation!`;

                    try {
                        await this.twitchBot.say(channels[0], message);
                    } catch (error) {
                        console.error('Error sending source-only PayPal message to Twitch:', error.message);
                    }
                } catch (error) {
                    console.error('Error sending donation message to Twitch:', error);
                }
            }

            if (branding.donationSound) {
                try {
                    const donationSoundPath = path.resolve(__dirname, '..', branding.donationSound);
                    if (!fs.existsSync(donationSoundPath)) {
                        throw new Error(`Configured donation sound does not exist: ${donationSoundPath}`);
                    }
                    soundPlayer.playSound(donationSoundPath);
                } catch (error) {
                    console.error('Error playing donation sound:', error);
                }
            }
        } catch (error) {
            console.error('Error in announceDonation:', error);
        }
    }

    setStreamingStatus(isStreaming) {
        const wasStreaming = this.isStreaming;
        this.isStreaming = isStreaming;

        if (isStreaming && !wasStreaming) {
            this.streamStartTime = new Date();
            this.lastCheck = this.streamStartTime;

            if (!this.interval) {
                this.interval = setInterval(() => this.checkForNewTransactions(), 5 * 60 * 1000);
            }

            this.checkForNewTransactions().catch(error => {
                console.error('Initial PayPal transaction check failed:', error);
            });
        } else if (!isStreaming && wasStreaming) {
            this.streamStartTime = null;

            if (this.interval) {
                clearInterval(this.interval);
                this.interval = null;
            }
        }
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}

module.exports = PayPalMonitor;