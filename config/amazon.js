module.exports = {
    affiliateTag: process.env.AMAZON_AFFILIATE_TAG || '',
    
    // Amazon domains to handle (you can add more regional domains if needed)
    amazonDomains: [
        'a.co',
        'amazon.com',
        'amazon.co.uk',
        'amazon.ca',
        'amazon.com.au',
        'amazon.de',
        'amazon.fr',
        'amazon.it',
        'amazon.es',
        'amazon.co.jp',
        'amazon.in',
        'amazon.com.mx',
        'amazon.com.br'
    ],
    
    // Cache settings for product info
    cacheDuration: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    
    // User-Agent for Amazon requests
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};