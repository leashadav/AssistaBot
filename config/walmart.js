module.exports = {
    walmartDomains: ['walmart.com', 'www.walmart.com'],
    affiliateTag: process.env.WALMART_AFFILIATE_TAG || '',
    cacheDuration: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
};
