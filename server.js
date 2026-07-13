import 'dotenv/config';
import express from 'express';
import { getPostComments, getAdPost } from './index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// ----- Yorum Çekme -----
app.post('/api/comments', async (req, res) => {
  try {
    const { postUrl, cookies } = req.body;
    if (!postUrl) return res.status(400).json({ error: 'Post URL gerekli' });

    const token = process.env.BROWSERLESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'BROWSERLESS_TOKEN ayarlanmamış' });

    const options = {
      browserlessToken: token,
      maxComments: 100,
      debug: process.env.DEBUG === 'true'
    };

    if (cookies) {
      options.cookies = cookies;
      console.log('Panelden gönderilen cookies kullanılıyor');
    } else if (process.env.FACEBOOK_COOKIES) {
      options.cookies = process.env.FACEBOOK_COOKIES;
      console.log('FACEBOOK_COOKIES env kullanılıyor');
    }

    const data = await getPostComments(postUrl, options);

    const comments = (data || []).map(c => ({
      id: c.legacy_fbid || c.id || '',
      authorName: c.author?.name || 'Bilinmiyor',
      authorId: c.author?.id || '',
      authorProfileUrl: c.author?.profile_url || '',
      message: c.body || '',
      createdTime: c.created_time || '',
      reactionCount: c.reaction_count || 0
    }));

    res.json({ comments });
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- Reklam Çekme -----
app.post('/api/adpost', async (req, res) => {
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
      console.log('[AdPost] Panelden gönderilen cookies kullanılıyor');
    } else if (process.env.FACEBOOK_COOKIES) {
      options.cookies = process.env.FACEBOOK_COOKIES;
      console.log('[AdPost] FACEBOOK_COOKIES env kullanılıyor');
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
});

app.use(express.static('public'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Dentrakip çalışıyor → http://localhost:' + PORT);
});
