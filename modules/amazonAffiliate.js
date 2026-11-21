require('./configLoader');

const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/amazon');
const { v4: uuidv4 } = require('uuid');

// Cache for product information
const productCache = new Map();

class AmazonAffiliate {
    /**
     * Clear the product cache
     * @returns {number} Number of items cleared from cache
     */
    clearCache() {
        const size = productCache.size;
        productCache.clear();
        return size;
    }

    constructor() {
        // Compile regex pattern for Amazon URLs
        this.amazonPattern = new RegExp(
            String.raw`https?:\/\/(?:www\.)?(?:${config.amazonDomains.join('|').replace(/\./g, '\\.')})\/(?:dp\/([A-Z0-9]+)|gp\/product\/([A-Z0-9]+)|d\/([A-Z0-9]+)|[^\/]*\/(?:dp|gp\/product|d)\/([A-Z0-9]+))(?:[^\s)\]}>,'\"]*)?`,
            'gi'
        );
        this.enabled = true;
    }

    /**
     * Enable or disable the Amazon affiliate functionality
     * @param {boolean} enabled - Whether to enable or disable
     */
    setEnabled(enabled) {
        this.enabled = !!enabled;
    }

    /**
     * Check if the Amazon affiliate functionality is enabled for a specific guild
     * @param {string} guildId - The guild ID to check
     * @param {Object} guildSettings - Guild settings object
     * @returns {boolean} Whether the functionality is enabled for this guild
     */
    isEnabledForGuild(guildId, guildSettings) {
        if (!guildSettings) return true;
        const settings = guildSettings.getSettings(guildId);
        return settings.amazonEnabled !== false; // Default to true if not set
    }

    /**
     * Remove all Amazon URLs (including trailing ref/query fragments) from a text string
     * @param {string} text
     * @returns {string}
     */
    stripAmazonUrls(text) {
        try {
            let out = text;
            // Remove full Amazon URLs first
            out = out.replace(this.amazonPattern, '');
            // Remove orphaned fragments that often remain like ?sr=... & /ref=... or leading &param=...
            out = out
                // Remove sequences starting with space or line start that look like leftover query or ref
                .replace(/(?:^|\s)(?:\?(?:[^\s]|\s(?!\S))*|\/ref=[^\s]+)/g, ' ')
                // Remove leading ampersand param sequences that may remain
                .replace(/(?:^|\s)&[a-zA-Z0-9_%-]+=[^\s]+/g, ' ')
                // Collapse multiple ampersand params left in a row
                .replace(/(?:^|\s)(?:[?&][^\s]+)(?:\s+(?:[?&][^\s]+))+/g, ' ');
            // Normalize whitespace
            out = out.replace(/\s{2,}/g, ' ').trim();
            return out;
        } catch (e) {
            return text;
        }
    }

    /**
     * Process a message to find and replace Amazon links
     * @param {Message} message - The Discord message to process
     * @param {Object} guildSettings - Guild settings object
     * @returns {Promise<void>}
     */
    async processMessage(message, guildSettings) {
        // Don't process messages from bots or DMs
        if (message.author.bot || !message.guild) return;

        // Check if Amazon affiliate functionality is enabled for this guild
        if (!this.isEnabledForGuild(message.guild.id, guildSettings)) return;

        const content = message.content;
        const matches = [...content.matchAll(this.amazonPattern)];

        if (!matches.length) return;

        const requestId = uuidv4();

        try {
            const processedLinks = [];
            const channel = message.channel;
            const threadParent = channel.isThread() ? channel.parent : channel;

            for (const match of matches) {
                const asin = match[1] || match[2] || match[3] || match[4];
                const originalUrl = match[0];

                if (processedLinks.includes(originalUrl)) continue;
                processedLinks.push(originalUrl);

                // For a.co URLs, we need to follow the redirect to get the real ASIN
                let realAsin = asin;
                if (originalUrl.includes('a.co/')) {
                    try {
                        const redirectResponse = await axios.get(originalUrl, {
                            maxRedirects: 5,
                            timeout: 15000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                                'Accept-Language': 'en-US,en;q=0.9',
                                'Accept-Encoding': 'gzip, deflate, br',
                                'DNT': '1',
                                'Connection': 'keep-alive',
                                'Upgrade-Insecure-Requests': '1',
                                'Sec-Fetch-Dest': 'document',
                                'Sec-Fetch-Mode': 'navigate',
                                'Sec-Fetch-Site': 'none',
                                'Sec-Fetch-User': '?1',
                                'Cache-Control': 'max-age=0',
                                'Referer': 'https://www.google.com/'
                            }
                        });
                        const finalUrl = redirectResponse.request.res.responseUrl || originalUrl;
                        const realAsinMatch = finalUrl.match(/\/dp\/([A-Z0-9]+)/i) || finalUrl.match(/\/gp\/product\/([A-Z0-9]+)/i);
                        if (realAsinMatch) {
                            realAsin = realAsinMatch[1];
                        }
                    } catch (redirectError) {
                        // Use original ASIN as fallback
                    }
                }

                const affiliateUrl = this.convertToAffiliateLink(originalUrl, realAsin);
                const productInfo = await this.getProductInfo(realAsin, originalUrl);
                const embed = this.createProductEmbed(productInfo, affiliateUrl, message.guild?.id);
                const newContent = this.stripAmazonUrls(message.content);
                const imageAttachments = [...message.attachments.values()].filter(attachment => {
                    const contentType = attachment.contentType?.toLowerCase().split(';')[0];
                    return contentType
                        ? /^image\/(png|jpeg|gif|webp|avif)$/.test(contentType)
                        : /\.(png|jpe?g|gif|webp|avif)$/i.test(attachment.name || '');
                });
                const imageFiles = imageAttachments.map(attachment => {
                    const extension = attachment.name?.match(/\.(png|jpe?g|gif|webp|avif)$/i)?.[0]
                        || ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif' }[attachment.contentType?.toLowerCase()] || '.png');
                    return {
                        attachment: attachment.url,
                        name: `user-upload-${attachment.id}${extension}`
                    };
                });
                const embeds = [
                    embed,
                    ...imageFiles.slice(0, 9).map(file => new EmbedBuilder().setImage(`attachment://${file.name}`))
                ];

                try {
                    // Try to find existing webhook first
                    const webhooks = await threadParent.fetchWebhooks();
                    let webhook = webhooks.find(w => w.owner?.id === message.client.user.id);

                    if (!webhook) {
                        webhook = await threadParent.createWebhook({
                            name: 'Amazon Linker',
                            reason: 'For Amazon affiliate link processing',
                            avatar: message.client.user.displayAvatarURL()
                        });
                    }

                    // Prepare webhook options - preserve original text but remove Amazon URLs
                    const webhookOptions = {
                        content: newContent || null, // Keep text but replace Amazon URLs with empty string
                        username: message.member?.displayName || message.author.username,
                        avatarURL: message.author.displayAvatarURL({ dynamic: true, size: 1024 }),
                        allowedMentions: { parse: [] },
                        embeds,
                        files: imageFiles
                    };

                    // Handle replies
                    if (message.reference?.messageId) {
                        webhookOptions.messageReference = {
                            messageId: message.reference.messageId,
                            channelId: message.channel.id,
                            guildId: message.guild?.id,
                            failIfNotExists: false
                        };

                        // Handle fallback for replies
                        if (message.channel.isTextBased()) {
                            try {
                                const replyMessage = await message.channel.messages.fetch(message.reference.messageId);
                                if (replyMessage) {
                                    const cleanReplyContent = this.stripAmazonUrls(message.content);
                                    webhookOptions.content = `${replyMessage.author} ${cleanReplyContent || ''}`.trim() || null;
                                }
                            } catch (error) {
                                // Error handling without console
                            }
                        }
                    }

                    // Add thread ID if in a thread
                    if (channel.isThread()) {
                        webhookOptions.threadId = channel.id;
                    }

                    // Send the webhook message
                    await webhook.send(webhookOptions);
                    if (message.deletable) {
                        await message.delete().catch(() => {});
                    }

                } catch (webhookError) {
                    // Webhook failed, using fallback
                    try {
                        const cleanContent = this.stripAmazonUrls(message.content);
                        await channel.send({
                            content: `**${message.member?.displayName || message.author.username}:** ${cleanContent}`,
                            allowedMentions: { parse: [] },
                            embeds,
                            files: imageFiles
                        });
                        if (message.deletable) {
                            await message.delete().catch(() => {});
                        }
                    } catch (fallbackError) {
                        console.error('Failed to repost Amazon product message:', fallbackError);
                    }
                }
            }
        } catch (error) {
            // Error handling without console
        }
    }

    /**
     * Convert a regular Amazon URL to an affiliate link
     * @param {string} url - The original Amazon URL
     * @param {string} asin - The product ASIN
     * @returns {string} The affiliate URL
     */
    convertToAffiliateLink(url, asin) {
        try {
            // Always use the US domain for consistent experience
            const domain = 'www.amazon.com';
            return `https://${domain}/dp/${asin}/?tag=${config.affiliateTag}`;
        } catch (error) {
            // Return original URL if something goes wrong
            return url;
        }
    }

    /**
     * Get product information, either from cache or by scraping
     * @param {string} asin - The product ASIN
     * @param {string} originalUrl - The original product URL
     * @returns {Promise<Object>} Product information object
     */
    async getProductInfo(asin, originalUrl) {
        // Check cache first
        const cached = productCache.get(asin);
        if (cached) {
            const cacheAge = Date.now() - cached.timestamp;
            const cachedTitle = this.normalizeProductTitle(cached.data.title);
            const hasProductTitle = cachedTitle && !/^Amazon Product(?:\s*\([A-Z0-9]+\))?$/i.test(cachedTitle);
            if (cacheAge < config.cacheDuration && hasProductTitle) {
                return cached.data;
            }
            productCache.delete(asin);
        }

        const maxRetries = 3;
        const domains = ['www.amazon.com', 'www.amazon.co.uk', 'www.amazon.ca', 'www.amazon.com.au'];
        try {
            const originalHost = new URL(originalUrl).hostname;
            if (domains.includes(originalHost)) {
                domains.splice(domains.indexOf(originalHost), 1);
                domains.unshift(originalHost);
            }
        } catch (error) {
            // Use the default domain order if the original URL is invalid.
        }
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const domain = domains[attempt % domains.length];
                const productPath = attempt === 0 ? `/gp/aw/d/${asin}` : `/dp/${asin}/`;
                const productUrl = `https://${domain}${productPath}?tag=${config.affiliateTag}&language=en_US&currency=USD`;

                // Scrape product page
                const response = await axios.get(productUrl, {
                    maxRedirects: 5,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Upgrade-Insecure-Requests': '1',
                        'Referer': `https://${domain}/`
                    },
                    timeout: 20000
                });

                if (typeof response.data !== 'string' || !response.data) {
                    throw new Error('No data received from Amazon');
                }

                // Check for captcha or access denied pages
                const blockedIndicators = [
                    'To discuss automated access to Amazon data',
                    'Enter the characters you see below',
                    'Robot check',
                    'CAPTCHA',
                    'Security measure',
                    'try accessing the site again later',
                    'Service Unavailable',
                    'access denied',
                    'Sorry! Something went wrong',
                    'Looking for something? We’re sorry'
                ];
                
                const isBlocked = blockedIndicators.some(indicator => 
                    response.data.toLowerCase().includes(indicator.toLowerCase())
                );
                
                if (isBlocked || response.status === 503) {
                    throw new Error('Amazon is showing a captcha or access denied page');
                }

                const $ = cheerio.load(response.data);

                // Extract product information
                const title = this.extractProductTitle($);
                const description = this.extractProductDescription($);
                const imageUrl = this.extractProductImage($);

                if (!title && !imageUrl) {
                    throw new Error('Amazon response did not contain product details');
                }

                const productInfo = {
                    title: title || this.getFallbackProductInfo(asin, originalUrl).title,
                    description: description || '',
                    imageUrl: imageUrl || this.getFallbackProductImageUrl(asin),
                    asin: asin,
                    url: originalUrl,
                    isFallback: !title
                };

                // Cache the result
                productCache.set(asin, {
                    data: productInfo,
                    timestamp: Date.now()
                });

                return productInfo;

            } catch (error) {
                lastError = error;
                // Wait before retrying (exponential backoff)
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
                }
            }
        }

        // If we get here, all attempts failed
        console.error(`Unable to retrieve Amazon product details for ASIN ${asin}:`, lastError?.message || 'Unknown error');
        return this.getFallbackProductInfo(asin, originalUrl);
    }

    /**
     * Normalize a product title and reject generic Amazon page titles.
     * @private
     * @param {string} title - Raw title text
     * @returns {string} Cleaned product title
     */
    normalizeProductTitle(title) {
        if (!title || typeof title !== 'string') return '';

        let cleaned = title.replace(/\s+/g, ' ').trim();
        if (!cleaned) return '';

        cleaned = cleaned.replace(/^\s*[-–—:]+\s*/, '').replace(/\s*[-–—:]+\s*$/, '');

        // Remove Amazon.com prefix
        cleaned = cleaned.replace(/^amazon(?:\.[a-z]{2,3})?\s*[-–—:|]\s*/i, '');
        cleaned = cleaned.replace(/^amazon\.com\s*[-–—:|]\s*/i, '');

        // Remove Amazon.com suffix
        cleaned = cleaned.replace(/\s*[-–—:|]\s*Amazon\.com$/i, '');
        cleaned = cleaned.replace(/\s*[-–—:|]\s*Amazon(?:\.[a-z]{2,3})?$/i, '');

        // Remove category suffixes like ": Home & Kitchen", " - Electronics", etc.
        const categorySuffixPattern = /\s*[:\-–—|]\s*(?:Home & Kitchen|Cell Phones & Accessories|Electronics|Books|Toys(?:\s*&\s*Games)?|Beauty|Fashion|Sports|Office|Pet|Tools|Automotive|Baby|Grocery|Industrial|Software|Apps|Movies|Music|Video Games|DIY(?:\s*&\s*Tools)?|Bricolage|Jardin|Cuisine|Maison|High-Tech|Sports et Loisirs|Jouets|Beauté et Mode|Alimentation et Boissons|Animalerie|Auto et Moto|Bébé|High-Tech|Livres|Jardin|Bricolage|Musique|DVD et Blu-ray|Jeux vidéo|Fournitures de bureau|Santé et Soins personnels|Informatique|Health(?:\s*&\s*Household)?|Dinner Plates|Patio, Lawn & Garden|Grocery & Gourmet Food|Tools & Home Improvement|Sports(?:\s*&\s*Outdoors)?|Industrial(?:\s*&\s*Scientific)?|Beauty & Personal Care|Clothing, Shoes & Jewelry|Musical Instruments|Pet Supplies|Everything Else)$/i;
        let titleWithoutCategory;
        do {
            titleWithoutCategory = cleaned.replace(categorySuffixPattern, '').trim();
            if (titleWithoutCategory === cleaned) break;
            cleaned = titleWithoutCategory;
        } while (true);

        cleaned = cleaned.trim();

        // Check for generic Amazon page titles
        const genericPatterns = [
            /^amazon(?:\.[a-z]{2,3})?$/i,
            /^amazon\.com$/i,
            /^(?:shop|browse|department|category|deals|best sellers|new & used|new releases)\b/i,
            /^électroménager$/i,
            /^(?:[a-z0-9-]+)\s*:\s*amazon(?:\.[a-z]{2,3})?/i,
            /^.*\b(?:department|category|shop|browse|deals|results|best sellers)\b.*$/i
        ];

        if (genericPatterns.some(pattern => pattern.test(cleaned))) {
            return '';
        }

        if (cleaned.length < 8 || cleaned.length > 220) {
            return '';
        }

        return cleaned;
    }

    /**
     * Extract product title from the page
     * @private
     * @param {Object} $ - Cheerio instance
     * @returns {string} Product title
     */
    extractProductTitle($) {
        const structuredTitle = this.extractStructuredProductTitle($);
        if (structuredTitle) return structuredTitle;

        const metaSelectors = [
            'meta[property="og:title"]',
            'meta[name="twitter:title"]',
            'meta[name="title"]'
        ];

        for (const selector of metaSelectors) {
            const value = $(selector).attr('content')?.trim();
            const normalized = this.normalizeProductTitle(value);
            if (normalized) return normalized;
        }

        const titleSelectors = [
            '#productTitle',
            'h1#title span',
            'h1.a-size-large',
            'h1.a-size-medium',
            '#title #productTitle',
            'span#productTitle',
            'h1.a-text-ellipsis',
            'span#btAsinTitle',
            'span#btAsinTitle_0',
            '[data-feature-name="product-title"]',
            '.product-title',
            'h1 span',
            'h1',
            '[data-cel-widget="search_result_title"]',
            '#titleSection',
            '.a-size-large.product-title-word-break',
            '.a-size-base-plus.a-text-bold',
            '[id*="title"]',
            '[class*="title"]'
        ];

        for (const selector of titleSelectors) {
            const title = $(selector).text().trim();
            const normalized = this.normalizeProductTitle(title);
            if (normalized) return normalized;
        }

        // Fallback: Look for any h1 that might contain the title
        let fallbackTitle = '';
        $('h1, [id*="title"], [class*="title"]').each((i, el) => {
            const text = $(el).text().trim();
            const normalized = this.normalizeProductTitle(text);
            if (normalized.length > 8 && normalized.length < 220) {
                fallbackTitle = normalized;
                return false; // Break the loop
            }
        });

        return fallbackTitle;
    }

    /**
     * Extract a structured product title from JSON-LD or other metadata.
     * @private
     * @param {Object} $ - Cheerio instance
     * @returns {string} Product title
     */
    extractStructuredProductTitle($) {
        try {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                const raw = $(scripts[i]).html() || '';
                if (!raw) continue;

                try {
                    const parsed = JSON.parse(raw);
                    const candidates = [];

                    const collect = (value) => {
                        if (Array.isArray(value)) {
                            value.forEach(collect);
                            return;
                        }
                        if (!value || typeof value !== 'object') return;
                        if (typeof value.name === 'string' && value.name.trim()) {
                            candidates.push(value.name.trim());
                        }
                        if (typeof value.headline === 'string' && value.headline.trim()) {
                            candidates.push(value.headline.trim());
                        }
                        if (value['@graph']) collect(value['@graph']);
                        if (value['@type'] && value['@type'] === 'Product') {
                            if (typeof value.name === 'string' && value.name.trim()) {
                                candidates.push(value.name.trim());
                            }
                        }
                    };

                    collect(parsed);
                    for (const candidate of candidates) {
                        const normalized = this.normalizeProductTitle(candidate);
                        if (normalized) return normalized;
                    }
                } catch (e) {
                    // Ignore invalid JSON-LD blocks
                }
            }
        } catch (error) {
            // Ignore metadata extraction errors
        }

        return '';
    }

    /**
     * Extract product description from the page
     * @private
     * @param {Object} $ - Cheerio instance
     * @returns {string} Product description
     */
    extractProductDescription($) {
        const structuredDescription = this.extractStructuredProductDescription($);
        if (structuredDescription) return structuredDescription;

        const metaSelectors = [
            'meta[property="og:description"]',
            'meta[name="description"]',
            'meta[name="twitter:description"]'
        ];

        for (const selector of metaSelectors) {
            const value = $(selector).attr('content')?.trim();
            if (value) return value;
        }

        const descriptionSelectors = [
            '#productDescription p',
            '#featurebullets_feature_div .a-list-item',
            '.product-description',
            '#descriptionAndDetails .a-section'
        ];

        for (const selector of descriptionSelectors) {
            const text = $(selector).first().text().trim();
            if (text) return text.replace(/\s+/g, ' ').trim();
        }

        return '';
    }

    /**
     * Extract a structured product description from JSON-LD or other metadata.
     * @private
     * @param {Object} $ - Cheerio instance
     * @returns {string} Product description
     */
    extractStructuredProductDescription($) {
        try {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                const raw = $(scripts[i]).html() || '';
                if (!raw) continue;

                try {
                    const parsed = JSON.parse(raw);
                    const candidates = [];

                    const collect = (value) => {
                        if (Array.isArray(value)) {
                            value.forEach(collect);
                            return;
                        }
                        if (!value || typeof value !== 'object') return;
                        if (typeof value.description === 'string' && value.description.trim()) {
                            candidates.push(value.description.trim());
                        }
                        if (typeof value.summary === 'string' && value.summary.trim()) {
                            candidates.push(value.summary.trim());
                        }
                        if (value['@graph']) collect(value['@graph']);
                    };

                    collect(parsed);
                    for (const candidate of candidates) {
                        const normalized = this.normalizeProductTitle(candidate);
                        if (normalized) return normalized;
                    }
                } catch (e) {
                    // Ignore invalid JSON-LD blocks
                }
            }
        } catch (error) {
            // Ignore metadata extraction errors
        }

        return '';
    }

    /**
     * Extract product image URL from the page
     * @private
     * @param {Object} $ - Cheerio instance
     * @returns {string} Image URL
     */
    extractProductImage($) {
        const imageMetaSelectors = [
            'meta[property="og:image"]',
            'meta[name="twitter:image"]',
            'meta[name="twitter:image:src"]'
        ];

        const normalizeImageUrl = (value) => {
            if (!value || typeof value !== 'string') return '';

            try {
                const url = new URL(value.trim(), 'https://www.amazon.com');
                return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
            } catch (error) {
                return '';
            }
        };

        const getLargestDynamicImage = (value) => {
            try {
                const images = JSON.parse(value);
                const largestImage = Object.entries(images)
                    .filter(([url, size]) =>
                        Array.isArray(size) &&
                        size.length >= 2 &&
                        Number(size[0]) > 1 &&
                        Number(size[1]) > 1 &&
                        normalizeImageUrl(url)
                    )
                    .sort((a, b) => (Number(b[1][0]) * Number(b[1][1])) - (Number(a[1][0]) * Number(a[1][1])))[0];

                return largestImage ? normalizeImageUrl(largestImage[0]) : '';
            } catch (error) {
                return '';
            }
        };

        const structuredImage = this.extractStructuredProductImage($);
        if (structuredImage) {
            return normalizeImageUrl(structuredImage);
        }

        for (const selector of imageMetaSelectors) {
            const imageUrl = normalizeImageUrl($(selector).attr('content'));
            if (imageUrl) {
                return imageUrl;
            }
        }

        const imageSelectors = [
            '#imgTagWrapperId img',
            '#landingImage',
            '#main-image',
            '.a-dynamic-image',
            'img[data-old-hires]',
            'img[data-a-dynamic-image]',
            '#imgBlkFront',
            '.a-dynamic-image-container img',
            '.a-stretch-vertical img',
            '.imgTagWrapper img',
            '.a-image-wrapper img'
        ];

        for (const selector of imageSelectors) {
            const imgElement = $(selector).first();
            if (imgElement.length) {
                const dynamicImage = getLargestDynamicImage(imgElement.attr('data-a-dynamic-image') || '');
                const imageUrl = normalizeImageUrl(
                    imgElement.attr('data-old-hires') ||
                    dynamicImage ||
                    imgElement.attr('src')
                );
                if (imageUrl) return imageUrl;
            }
        }
        return '';
    }

    /**
     * Extract a product image from JSON-LD metadata.
     * @private
     * @param {Object} $ - Cheerio instance
     * @returns {string} Image URL
     */
    extractStructuredProductImage($) {
        const scripts = $('script[type="application/ld+json"]');
        for (let i = 0; i < scripts.length; i++) {
            try {
                const parsed = JSON.parse($(scripts[i]).html() || '');
                const collectImages = (value) => {
                    if (Array.isArray(value)) return value.flatMap(collectImages);
                    if (!value || typeof value !== 'object') return [];

                    const images = [];
                    if (typeof value.image === 'string') images.push(value.image);
                    else if (Array.isArray(value.image)) images.push(...value.image.filter(image => typeof image === 'string'));
                    else if (value.image && typeof value.image === 'object' && typeof value.image.url === 'string') {
                        images.push(value.image.url);
                    }
                    if (value['@graph']) images.push(...collectImages(value['@graph']));
                    return images;
                };

                const image = collectImages(parsed).find(Boolean);
                if (image) return image;
            } catch (error) {
                // Ignore invalid JSON-LD blocks.
            }
        }
        return '';
    }

    /**
     * Get fallback product info when scraping fails
     * @param {string} asin - Product ASIN
     * @param {string} url - Original product URL
     * @returns {Object} Fallback product info
     */
    getFallbackProductInfo(asin, url = '') {
        // Try to get at least product title from URL
        let title = 'Amazon Product';
        
        // Try to make a more descriptive title using the ASIN
        if (asin) {
            title = `Amazon Product (${asin})`;
        }

        if (url) {
            try {
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split('/');
                const productPathIndex = pathParts.findIndex((part, index) =>
                    part === 'dp' ||
                    part === 'd' ||
                    (part === 'product' && pathParts[index - 1] === 'gp')
                );
                const nameParts = productPathIndex > 0
                    ? pathParts.slice(1, productPathIndex).filter(part => part && part !== 'gp' && part !== asin)
                    : '';
                const namePart = nameParts.join('-');

                if (namePart) {
                    const cleanedPart = namePart.toLowerCase();
                    const ignoredPathSegments = ['amazon', 'amazonfr', 'amazoncom', 'electronics', 'home', 'beauty', 'sports', 'books', 'toys', 'fashion', 'office', 'grocery', 'tools', 'pet', 'automotive', 'industrial', 'baby', 'videogames', 'movies', 'music', 'kindle', 'software', 'apps'];

                    if (!ignoredPathSegments.includes(cleanedPart) && !cleanedPart.includes('category') && !cleanedPart.includes('shop') && !cleanedPart.includes('browse')) {
                        title = decodeURIComponent(namePart)
                            .replace(/[-_]/g, ' ')
                            .replace(/\+/g, ' ')
                            .replace(/\b\w/g, l => l.toUpperCase())
                            .trim()
                            .split('?')[0]
                            .split('#')[0]
                            .trim();

                        if (title.length > 100) {
                            title = title.substring(0, 97) + '...';
                        }

                        title = `${title} (${asin})`;
                    }
                }
            } catch (e) {
                // If URL parsing fails, use default title with ASIN
                title = `Amazon Product (${asin})`;
            }
        }

        return {
            title: title,
            description: title && title !== 'Amazon Product' ? title : 'Product details could not be fetched from Amazon.',
            imageUrl: this.getFallbackProductImageUrl(asin),
            asin: asin,
            url: url || `https://www.amazon.com/dp/${asin}?currency=USD`,
            isFallback: true
        };
    }

    getFallbackProductImageUrl(asin) {
        return /^[A-Z0-9]{10}$/i.test(asin || '')
            ? `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`
            : '';
    }

    /**
     * Create a product embed for Discord
     * @param {Object} productInfo - Product information
     * @param {string} affiliateUrl - Affiliate URL
     * @param {string} [guildId] - Optional guild ID for guild-specific settings
     * @returns {EmbedBuilder} - Discord embed
     */
    createProductEmbed(productInfo, affiliateUrl, guildId) {
        // Default color if no guildId is provided or guild settings don't have a custom color
        let embedColor = 0xff6600; // Default Amazon orange

        // Try to get guild-specific color if guildId is provided
        if (guildId) {
            try {
                const guildSettings = require('../data/guildSettings.json');
                if (guildSettings[guildId]?.embedColor) {
                    // Convert hex string to number
                    embedColor = parseInt(guildSettings[guildId].embedColor, 16);
                }
            } catch (error) {
                // Ignore error and use default color
            }
        }

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setURL(affiliateUrl)

        const cleanedTitle = this.normalizeProductTitle(productInfo.title);
        const cleanedDescription = this.normalizeProductTitle(productInfo.description) || productInfo.description || '';
        const title = cleanedTitle || cleanedDescription || 'Amazon Product';
        
        embed.setTitle(title);

        if (!cleanedTitle && cleanedDescription) {
            embed.setDescription(cleanedDescription);
        }

        if (productInfo.imageUrl) {
            embed.setImage(productInfo.imageUrl);
        }

        return embed;
    }
}

module.exports = new AmazonAffiliate();