const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/walmart');
const { v4: uuidv4 } = require('uuid');

// Cache for product information
const productCache = new Map();

class WalmartAffiliate {
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
        // Compile regex pattern for Walmart URLs
        // Walmart URLs are like: https://www.walmart.com/ip/PRODUCT-NAME/PRODUCT_ID
        this.walmartPattern = new RegExp(
            `https?:\/\/(?:www\.)?(?:${config.walmartDomains.join('|').replace(/\./g, '\\.')})\/ip\/[^\/]+\/([0-9]+)(?:[^\s)\]}>,'\"]*)?`,
            'gi'
        );
        this.enabled = true;
    }

    /**
     * Enable or disable the Walmart affiliate functionality
     * @param {boolean} enabled - Whether to enable or disable
     */
    setEnabled(enabled) {
        this.enabled = !!enabled;
    }

    /**
     * Check if the Walmart affiliate functionality is enabled for a specific guild
     * @param {string} guildId - The guild ID to check
     * @param {Object} guildSettings - Guild settings object
     * @returns {boolean} Whether the functionality is enabled for this guild
     */
    isEnabledForGuild(guildId, guildSettings) {
        if (!guildSettings) return true;
        const settings = guildSettings.getSettings(guildId);
        return settings.walmartEnabled !== false; // Default to true if not set
    }

    /**
     * Remove all Walmart URLs (including trailing ref/query fragments) from a text string
     * @param {string} text
     * @returns {string}
     */
    stripWalmartUrls(text) {
        try {
            let out = text;
            // Remove full Walmart URLs first
            out = out.replace(this.walmartPattern, '');
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
     * Process a message to find and replace Walmart links
     * @param {Message} message - The Discord message to process
     * @param {Object} guildSettings - Guild settings object
     * @returns {Promise<void>}
     */
    async processMessage(message, guildSettings) {
        // Don't process messages from bots or DMs
        if (message.author.bot || !message.guild) return;

        // Check if Walmart affiliate functionality is enabled for this guild
        if (!this.isEnabledForGuild(message.guild.id, guildSettings)) return;

        const content = message.content;
        const matches = [...content.matchAll(this.walmartPattern)];

        if (!matches.length) return;

        const requestId = uuidv4();

        try {
            const processedLinks = [];
            const channel = message.channel;
            const threadParent = channel.isThread() ? channel.parent : channel;

            for (const match of matches) {
                const productId = match[1];
                const originalUrl = match[0];

                if (processedLinks.includes(originalUrl)) continue;
                processedLinks.push(originalUrl);

                // For wmt.co URLs, we need to follow the redirect to get the real product ID
                let realProductId = productId;
                if (originalUrl.includes('wmt.co/')) {
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
                        const realProductIdMatch = finalUrl.match(/\/ip\/[^\/]+\/([0-9]+)/i);
                        if (realProductIdMatch) {
                            realProductId = realProductIdMatch[1];
                        }
                    } catch (redirectError) {
                        // Use original product ID as fallback
                    }
                }

                const affiliateUrl = this.convertToAffiliateLink(originalUrl, realProductId);
                const productInfo = await this.getProductInfo(realProductId, originalUrl);
                const embed = this.createProductEmbed(productInfo, affiliateUrl, message.guild?.id);
                const newContent = this.stripWalmartUrls(message.content);

                try {
                    // Try to find existing webhook first
                    const webhooks = await threadParent.fetchWebhooks();
                    let webhook = webhooks.find(w => w.owner?.id === message.client.user.id);

                    if (!webhook) {
                        webhook = await threadParent.createWebhook({
                            name: 'Walmart Linker',
                            reason: 'For Walmart affiliate link processing',
                            avatar: message.client.user.displayAvatarURL()
                        });
                    }

                    // Delete the original message if we can
                    try {
                        if (message.deletable) {
                            await message.delete();
                        }
                    } catch (deleteError) {
                        // Continue processing even if we can't delete the message
                    }

                    // Prepare webhook options - preserve original text but remove Walmart URLs
                    const webhookOptions = {
                        content: newContent || null, // Keep text but replace Walmart URLs with empty string
                        username: message.member?.displayName || message.author.username,
                        avatarURL: message.author.displayAvatarURL({ dynamic: true, size: 1024 }),
                        allowedMentions: { parse: [] },
                        embeds: [embed]
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
                                    const cleanReplyContent = this.stripWalmartUrls(message.content);
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

                } catch (webhookError) {
                    // Webhook failed, using fallback
                    try {
                        const cleanContent = this.stripWalmartUrls(message.content);
                        await channel.send({
                            content: `**${message.member?.displayName || message.author.username}:** ${cleanContent}`,
                            allowedMentions: { parse: [] }
                        });
                        await channel.send({ embeds: [embed] });
                    } catch (fallbackError) {
                        // Fallback message sending failed
                    }
                }
            }
        } catch (error) {
            // Error handling without console
        }
    }

    /**
     * Convert a regular Walmart URL to an affiliate link
     * @param {string} url - The original Walmart URL
     * @param {string} productId - The product ID
     * @returns {string} The affiliate URL
     */
    convertToAffiliateLink(url, productId) {
        try {
            // Always use the US domain for consistent experience
            const domain = 'www.walmart.com';
            return `https://${domain}/ip/${productId}/?affil=${config.affiliateTag}`;
        } catch (error) {
            // Return original URL if something goes wrong
            return url;
        }
    }

    /**
     * Get product information, either from cache or by scraping
     * @param {string} productId - The product ID
     * @param {string} originalUrl - The original product URL
     * @returns {Promise<Object>} Product information object
     */
    async getProductInfo(productId, originalUrl) {
        // Check cache first
        const cached = productCache.get(productId);
        if (cached) {
            const cacheAge = Date.now() - cached.timestamp;
            if (cacheAge < config.cacheDuration) {
                return cached.data;
            }
        }

        const maxRetries = 3;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Use the original URL if available, otherwise construct one
                const productUrl = originalUrl || `https://www.walmart.com/ip/${productId}`;

                // Scrape product page
                const response = await axios.get(productUrl, {
                    maxRedirects: 5,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'DNT': '1',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Sec-Fetch-User': '?1',
                        'Cache-Control': 'max-age=0',
                        'Referer': 'https://www.walmart.com/',
                        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"'
                    },
                    timeout: 20000
                });

                if (!response.data) {
                    throw new Error('No data received from Walmart');
                }

                // Check for captcha or access denied pages
                const blockedIndicators = [
                    'Access denied',
                    'CAPTCHA',
                    'Security measure',
                    'try accessing the site again later',
                    'Service Unavailable',
                    'Robot or human?'
                ];
                
                const isBlocked = blockedIndicators.some(indicator => 
                    response.data.toLowerCase().includes(indicator.toLowerCase())
                );
                
                if (isBlocked || response.status === 503) {
                    throw new Error('Walmart is showing a captcha or access denied page');
                }

                const $ = cheerio.load(response.data);

                // Extract product information
                const title = this.extractProductTitle($);
                const description = this.extractProductDescription($);
                const imageUrl = this.extractProductImage($);

                const productInfo = {
                    title: title || description || 'Walmart Product',
                    description: description || '',
                    imageUrl: imageUrl || 'https://via.placeholder.com/300x300?text=No+Image+Available',
                    productId: productId,
                    url: originalUrl,
                    isFallback: false
                };

                // Cache the result
                productCache.set(productId, {
                    data: productInfo,
                    timestamp: Date.now()
                });

                return productInfo;

            } catch (error) {
                // Wait before retrying (exponential backoff)
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
                }
            }
        }

        // If we get here, all attempts failed
        return this.getFallbackProductInfo(productId, originalUrl);
    }

    /**
     * Normalize a product title and reject generic Walmart page titles.
     * @private
     * @param {string} title - Raw title text
     * @returns {string} Cleaned product title
     */
    normalizeProductTitle(title) {
        if (!title || typeof title !== 'string') return '';

        let cleaned = title.replace(/\s+/g, ' ').trim();
        if (!cleaned) return '';

        cleaned = cleaned.replace(/^\s*[-–—:]+\s*/, '').replace(/\s*[-–—:]+\s*$/, '');

        // Remove Walmart.com prefix
        cleaned = cleaned.replace(/^walmart(?:\.[a-z]{2,3})?\s*[:|]\s*/i, '');
        cleaned = cleaned.replace(/^walmart\.com\s*[:|]\s*/i, '');

        // Remove Walmart.com suffix
        cleaned = cleaned.replace(/\s*[-–—]\s*Walmart\.com$/i, '');
        cleaned = cleaned.replace(/\s*[-–—]\s*Walmart(?:\.[a-z]{2,3})?$/i, '');

        // Remove category suffixes
        const categorySuffixPattern = /\s*[:\-–—|]\s*(?:Electronics|Home|Beauty|Sports|Books|Toys|Fashion|Office|Grocery|Tools|Automotive|Baby|Industrial|Software|Apps|Movies|Music|Video Games|Health|Household|Patio|Lawn|Garden|Pet Supplies)$/i;
        cleaned = cleaned.replace(categorySuffixPattern, '');

        cleaned = cleaned.trim();

        // Check for generic Walmart page titles
        const genericPatterns = [
            /^walmart(?:\.[a-z]{2,3})?$/i,
            /^walmart\.com$/i,
            /^(?:shop|browse|department|category|deals|best sellers|new releases)\b/i
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
            'h1.prod-product-title',
            'h1[itemprop="name"]',
            '.prod-ProductTitle',
            '.product-title',
            'h1',
            '[data-testid="product-title"]',
            '.lh-title',
            '.f6.f5-l.fw-normal.mb0.mt1',
            '.w_iUH7'
        ];

        for (const selector of titleSelectors) {
            const title = $(selector).text().trim();
            const normalized = this.normalizeProductTitle(title);
            if (normalized) return normalized;
        }

        // Fallback: Look for any h1 that might contain the title
        let fallbackTitle = '';
        $('h1, [itemprop="name"]').each((i, el) => {
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
     * Extract product description from the page
     * @private
     * @param {Object} $ - Cheerio instance
     * @returns {string} Product description
     */
    extractProductDescription($) {
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
            '.prod-product-description',
            '[itemprop="description"]',
            '.product-description',
            '.prod-ProductDescription'
        ];

        for (const selector of descriptionSelectors) {
            const text = $(selector).first().text().trim();
            if (text) return text.replace(/\s+/g, ' ').trim();
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

        for (const selector of imageMetaSelectors) {
            const imageUrl = $(selector).attr('content')?.trim();
            if (imageUrl) {
                return imageUrl.startsWith('http') ? imageUrl : `https:${imageUrl}`;
            }
        }

        const imageSelectors = [
            '.prod-hero-image-container img',
            '[data-testid="product-image"] img',
            '.prod-ProductImage img',
            '.product-image img',
            'img[itemprop="image"]',
            '.hover-zoom-hero-image-container img',
            '.img-container img',
            '.w-100.h-100.object-cover'
        ];

        for (const selector of imageSelectors) {
            const imgElement = $(selector).first();
            if (imgElement.length) {
                let imageUrl = imgElement.attr('src') || imgElement.attr('data-src') || imgElement.attr('data-original') || '';

                if (imageUrl) {
                    // Ensure the URL is absolute
                    if (!imageUrl.startsWith('http')) {
                        imageUrl = `https:${imageUrl}`;
                    }
                    return imageUrl;
                }
            }
        }
        return '';
    }

    /**
     * Get fallback product info when scraping fails
     * @param {string} productId - Product ID
     * @param {string} url - Original product URL
     * @returns {Object} Fallback product info
     */
    getFallbackProductInfo(productId, url = '') {
        // Try to get at least product title from URL
        let title = 'Walmart Product';
        
        // Try to make a more descriptive title using the product ID
        if (productId) {
            title = `Walmart Product (${productId})`;
        }

        if (url) {
            try {
                // Try to extract product name from URL
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split('/');
                
                // Walmart URLs are like: /ip/PRODUCT-NAME/PRODUCT_ID
                // Find the product name part (between /ip/ and /PRODUCT_ID)
                const ipIndex = pathParts.indexOf('ip');
                if (ipIndex !== -1 && ipIndex + 1 < pathParts.length) {
                    const namePart = pathParts[ipIndex + 1];
                    
                    if (namePart && namePart !== productId) {
                        // Convert URL-encoded string to human-readable format
                        title = decodeURIComponent(namePart)
                            .replace(/[-_]/g, ' ') // Replace underscores and hyphens with spaces
                            .replace(/\s+/g, ' ')  // Normalize spaces
                            .trim();

                        // Title case
                        title = title.replace(/\b\w/g, l => l.toUpperCase());

                        // Limit title length
                        if (title.length > 100) {
                            title = title.substring(0, 97) + '...';
                        }
                    }
                }
            } catch (e) {
                // If URL parsing fails, use default title with product ID
                title = `Walmart Product (${productId})`;
            }
        }

        return {
            title: title,
            description: 'Product details could not be fetched from Walmart.',
            imageUrl: 'https://via.placeholder.com/300x300?text=Product+Image+Not+Available',
            productId: productId,
            url: url || `https://www.walmart.com/ip/${productId}`,
            isFallback: true
        };
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
        let embedColor = 0xff6600;

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
        const title = cleanedTitle || cleanedDescription || 'Walmart Product';
        
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

module.exports = new WalmartAffiliate();