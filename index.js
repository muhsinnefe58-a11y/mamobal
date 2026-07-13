import { getAdPost } from '../../index.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST istekleri kabul edilir' });
  }

  const apiKey = req.headers['x-api-key'];
  if (process.env.API_KEY && apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Geçersiz API anahtarı' });
  }

  try {
    const { url, cookies, maxComments } = req.body;
    if (!url) return res.status(400).json({ error: 'Reklam URL\'si gerekli' });

    const token = process.env.BROWSERLESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'BROWSERLESS_TOKEN ayarlanmamış' });

    const options = {
      browserlessToken: token,
      maxComments: maxComments || 0,
      debug: process.env.DEBUG === 'true',
    };

    if (cookies) {
      options.cookies = cookies;
    } else if (process.env.FACEBOOK_COOKIES) {
      options.cookies = process.env.FACEBOOK_COOKIES;
    }

    const result = await getAdPost(url, options);

    const adData = {
      advertiser: result.ad?.advertiser || '',
      headline: result.ad?.headline || '',
      bodyText: result.ad?.body_text || '',
      cta: result.ad?.cta || '',
      image: result.ad?.image || '',
      date: result.ad?.date || '',
      adId: result.ad?.ad_id || '',
      url: result.ad?.url || url,
      underlyingPostUrl: result.ad?.underlying_post_url || '',
    };

    const comments = (result.comments || []).map(c => ({
      id: c.legacy_fbid || c.id || '',
      authorName: c.author?.name || 'Bilinmiyor',
      authorId: c.author?.id || '',
      authorProfileUrl: c.author?.profile_url || '',
      message: c.body || '',
      createdTime: c.created_time || '',
      reactionCount: c.reaction_count || 0,
    }));

    res.json({
      ad: adData,
      comments,
      totalComments: result.totalComments || comments.length,
      scrapedAt: result.scrapedAt || new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AdPost API] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
