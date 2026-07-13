import { readFileSync } from 'fs';
import puppeteer from 'puppeteer-core';

export function parseAbbreviatedNumber(str) {
  if (!str) return 0;
  const clean = str.replace(/,/g, '').trim().toUpperCase();
  const match = clean.match(/^([\d.]+)\s*([KMB]?)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const modifier = match[2];
  if (modifier === 'K') return Math.round(num * 1000);
  if (modifier === 'M') return Math.round(num * 1000000);
  if (modifier === 'B') return Math.round(num * 1000000000);
  return Math.round(num);
}

export async function getBrowser(options = {}) {
  if (options.browser) return options.browser;

  const token = options.browserlessToken || process.env.BROWSERLESS_TOKEN;
  const wsEndpoint = options.browserWSEndpoint || (token ? `wss://chrome.browserless.io?token=${token}` : null);

  if (wsEndpoint) {
    return await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
  }

  throw new Error(
    'No Puppeteer browser or browserless token/endpoint provided.'
  );
}

export async function parseCookies(cookiesOrFile) {
  if (!cookiesOrFile) return [];
  if (Array.isArray(cookiesOrFile)) return cookiesOrFile;

  if (typeof cookiesOrFile === 'object' && cookiesOrFile.file) {
    const filePath = cookiesOrFile.file;
    const ext = filePath.split('.').pop().toLowerCase();
    const raw = readFileSync(filePath, 'utf-8');

    if (ext === 'json') {
      return JSON.parse(raw);
    }

    const lines = raw.split('\n');
    const cookies = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('HttpOnly,')) continue;
      const parts = trimmed.split('\t');
      if (parts.length >= 7) {
        cookies.push({
          name: parts[5].trim(),
          value: parts[6].trim(),
          domain: parts[0].trim(),
        });
      } else {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          cookies.push({
            name: trimmed.slice(0, eqIdx).trim(),
            value: trimmed.slice(eqIdx + 1).trim(),
            url: 'https://www.facebook.com',
          });
        }
      }
    }
    return cookies;
  }

  if (typeof cookiesOrFile === 'string') {
    return cookiesOrFile.split(';').map(c => {
      const eqIdx = c.indexOf('=');
      if (eqIdx === -1) return null;
      return {
        name: c.slice(0, eqIdx).trim(),
        value: c.slice(eqIdx + 1).trim(),
        url: 'https://www.facebook.com',
      };
    }).filter(Boolean);
  }

  return [];
}

async function setPageCookies(page, cookies) {
  if (!cookies) return;
  const cookieList = await parseCookies(cookies);
  if (cookieList.length === 0) return;

  const hasLocale = cookieList.some(c => c.name === 'locale');
  if (!hasLocale) {
    cookieList.push({ name: 'locale', value: 'tr_TR', domain: '.facebook.com' });
  }

  console.log(`Setting ${cookieList.length} cookies...`);
  await page.setCookie(...cookieList);
}

function isAdsLibraryUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.includes('facebook.com') && u.pathname.includes('/ads/library');
  } catch {
    return false;
  }
}

export async function scrapePosts(browser, account, options = {}) {
  const {
    pages = 1,
    isGroup = false,
    cookies = null,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    delay = 2000,
    debug = false,
  } = options;

  const page = await browser.newPage();
  try {
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    });
    await page.setViewport({ width: 1280, height: 800 });

    if (cookies) {
      const cookieList = await parseCookies(cookies);
      if (cookieList.length > 0) await page.setCookie(...cookieList);
    }

    let baseUrl = isGroup
      ? `https://www.facebook.com/groups/${account}`
      : `https://www.facebook.com/${account}`;

    let currentUrl = baseUrl;
    const allPosts = [];

    for (let p = 0; p < pages; p++) {
      console.log(`Scraping page ${p + 1} of ${pages}: ${currentUrl}`);

      const response = await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 60000 });

      await page.waitForSelector('div[role="article"]', { timeout: 20000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));

      const title = await page.title();
      console.log(`  Page title: "${title}"`);

      const finalUrl = page.url();
      const isLoginWall =
        title.toLowerCase().includes('log in') ||
        title.toLowerCase().includes('login') ||
        title.toLowerCase().includes('sign up') ||
        title.toLowerCase().includes('giriş') ||
        finalUrl.includes('/login') ||
        finalUrl.includes('login_via') ||
        finalUrl.includes('checkpoint');

      if (isLoginWall) {
        const msg =
          'Facebook oturum açma sayfasına yönlendirildi.\n' +
          'Bu sayfayı kazımak için geçerli Facebook çerezleri (cookies) gereklidir.\n' +
          `(Yönlendirilen URL: ${finalUrl})`;
        if (allPosts.length > 0) {
          console.warn('Login duvarına çarptı. Şimdiye kadar toplananlar döndürülüyor.');
          break;
        }
        throw new Error(msg);
      }

      if (response && response.status() === 404) {
        throw new Error(`Facebook sayfası/grubu "${account}" bulunamadı (404).`);
      }

      if (debug) {
        const { writeFileSync } = await import('fs');
        const html = await page.content();
        const fname = `debug_page_${p + 1}.html`;
        writeFileSync(fname, html, 'utf-8');
        console.log(`  [debug] HTML kaydedildi → ${fname}`);
      }

      const postsOnPage = await page.evaluate(() => {
        const posts = [];
        const articles = document.querySelectorAll('div[role="article"]');

        articles.forEach(article => {
          const role = article.getAttribute('role');
          if (role === 'status' || role === 'progressbar') return;

          const html = article.innerHTML.toLowerCase();

          if (
            html.includes('suggested for you') ||
            html.includes('sponsored') ||
            html.includes('reklam') ||
            html.includes('önerilen') ||
            html.includes('yükleniyor')
          ) return;

          let text = '';
          const textBlocks = article.querySelectorAll(
            'div[data-ad-rendering-role="story_message"] span, ' +
            'div[data-ad-preview="message"] span'
          );
          if (textBlocks.length > 0) {
            text = Array.from(textBlocks).map(s => s.textContent).join('\n').trim();
          } else {
            const allSpans = article.querySelectorAll('span');
            const meaningful = Array.from(allSpans).filter(s => {
              const t = s.textContent.trim();
              return t.length > 20 && !s.closest('a[role="link"]');
            });
            if (meaningful.length > 0) {
              text = meaningful.map(s => s.textContent.trim()).filter(Boolean).join('\n');
            } else {
              const clone = article.cloneNode(true);
              const headerLinks = clone.querySelectorAll('[role="link"]');
              headerLinks.forEach(el => {
                const txt = el.textContent.trim();
                if (txt.length < 60) el.remove();
              });
              text = clone.textContent.trim();
            }
          }

          const actorLink = article.querySelector(
            'a[role="link"][tabindex="0"]:not([href*="/photo"]):not([href*="/comment"])'
          );
          const username = actorLink ? actorLink.textContent.trim() : null;
          let userUrl = actorLink ? actorLink.getAttribute('href') : null;
          if (userUrl && userUrl.startsWith('/')) {
            userUrl = 'https://www.facebook.com' + userUrl;
          }

          const timeAnchor = article.querySelector('a[role="link"] span[style*="white-space"]');
          const timeText = timeAnchor ? timeAnchor.textContent.trim() : null;

          const links = [];
          const anchors = article.querySelectorAll('a:not([role="link"])');
          anchors.forEach(a => {
            const href = a.getAttribute('href');
            if (href && !href.startsWith('#') && !href.startsWith('/')) {
              links.push({ text: a.textContent.trim(), href });
            }
          });

          const images = [];
          const imgs = article.querySelectorAll('img');
          imgs.forEach(img => {
            const src = img.getAttribute('src');
            const w = img.getAttribute('width');
            if (
              src &&
              !src.includes('static.xx.fbcdn.net') &&
              !src.includes('emoji.php') &&
              (!w || parseInt(w) > 32)
            ) {
              images.push(src);
            }
          });

          let postUrl = null;
          const storyLink = article.querySelector(
            'a[href*="/posts/"], a[href*="story_fbid="], a[href*="/permalink/"], a[href*="/story.php"]'
          );
          if (storyLink) {
            const href = storyLink.getAttribute('href');
            if (href) {
              postUrl = href.startsWith('http') ? href : 'https://www.facebook.com' + href;
            }
          }

          const textContent = article.textContent || '';

          posts.push({
            username,
            user_url: userUrl,
            text: text.trim(),
            time: timeText,
            links,
            images,
            post_url: postUrl,
            raw_text: textContent,
          });
        });

        return posts;
      });

      const parsedPosts = postsOnPage.map(post => {
        const text = post.raw_text;
        delete post.raw_text;

        const likesMatch = text.match(/([\d,.KM]+)\s*(Like|reaction|Beğen|beğenme)/i);
        const commentsMatch = text.match(/([\d,.KM]+)\s*(Comment|Yorum|yorum)/i);
        const sharesMatch = text.match(/([\d,.KM]+)\s*(Share|Paylaş|paylaşım)/i);

        return {
          ...post,
          likes: likesMatch ? parseAbbreviatedNumber(likesMatch[1]) : 0,
          comments: commentsMatch ? parseAbbreviatedNumber(commentsMatch[1]) : 0,
          shares: sharesMatch ? parseAbbreviatedNumber(sharesMatch[1]) : 0,
        };
      });

      allPosts.push(...parsedPosts);

      if (p < pages - 1) {
        const scrolled = await page.evaluate(async () => {
          const before = document.body.scrollHeight;
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(r => setTimeout(r, 2000));
          const after = document.body.scrollHeight;
          return after > before;
        });

        if (!scrolled) {
          const nextLinkHref = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const next = links.find(a => {
              const href = a.getAttribute('href') || '';
              const text = a.textContent.toLowerCase();
              const txtTrim = text.trim();
              return (
                href.includes('/posts/') ||
                text.includes('see more') ||
                txtTrim === 'daha fazla göster' ||
                text.includes('daha eski') ||
                text.includes('more stories')
              );
            });
            return next && next.href ? next.href : null;
          });

          if (nextLinkHref) {
            currentUrl = nextLinkHref;
          } else {
            console.log('No more pages found.');
            break;
          }
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return allPosts;
  } finally {
    await page.close();
  }
}

export async function scrapeProfile(browser, account, options = {}) {
  const {
    cookies = null,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  } = options;

  const page = await browser.newPage();
  try {
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    if (cookies) {
      const cookieList = await parseCookies(cookies);
      if (cookieList.length > 0) await page.setCookie(...cookieList);
    }

    const cleanAccount = account.replace('profile.php?id=', '');
    const aboutUrl = `https://www.facebook.com/${cleanAccount}/about`;
    console.log(`Scraping profile: ${aboutUrl}`);

    const response = await page.goto(aboutUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    const title = await page.title();
    if (title.toLowerCase().includes('login') || title.toLowerCase().includes('giriş') || title.toLowerCase().includes('log into facebook')) {
      throw new Error('Redirected to login page. Please provide valid cookies to scrape profile.');
    }

    if (response && response.status() === 404) {
      throw new Error(`Facebook profile "${account}" not found (404).`);
    }

    const profileData = await page.evaluate(() => {
      const data = {};
      const titleElem = document.querySelector('title');
      data.name = titleElem ? titleElem.textContent.split(' | ')[0].trim() : '';

      const sections = document.querySelectorAll('div[data-sigil="profile-card"]');
      sections.forEach(card => {
        const headerElem = card.querySelector('header');
        if (headerElem) {
          const header = headerElem.textContent.trim();
          const clone = card.cloneNode(true);
          const headerClone = clone.querySelector('header');
          if (headerClone) headerClone.remove();
          const content = clone.textContent ? clone.textContent.trim() : '';
          data[header] = content.split('\n').map(l => l.trim()).filter(l => l).join('\n');
        }
      });

      return data;
    });

    const pageHtml = await page.content();
    const entityMatch = pageHtml.match(/entity_id:(\d+)/) || pageHtml.match(/"id":"(\d+)"/);
    if (entityMatch) {
      profileData.id = entityMatch[1];
    }

    profileData.username = cleanAccount;
    return profileData;
  } finally {
    await page.close();
  }
}

export async function scrapeGroupInfo(browser, group, options = {}) {
  const {
    cookies = null,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  } = options;

  const page = await browser.newPage();
  try {
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    if (cookies) {
      const cookieList = await parseCookies(cookies);
      if (cookieList.length > 0) await page.setCookie(...cookieList);
    }

    const infoUrl = `https://www.facebook.com/groups/${group}/about`;
    console.log(`Scraping group info: ${infoUrl}`);

    const response = await page.goto(infoUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    const title = await page.title();
    if (title.toLowerCase().includes('login') || title.toLowerCase().includes('giriş') || title.toLowerCase().includes('log into facebook')) {
      throw new Error('Redirected to login page. Please provide valid cookies to scrape group info.');
    }

    if (response && response.status() === 404) {
      throw new Error(`Facebook group "${group}" not found (404).`);
    }

    const groupData = await page.evaluate(() => {
      const data = {};

      const nameElem = document.querySelector('header h3') || document.querySelector('title');
      data.name = nameElem ? nameElem.textContent.trim() : '';

      const typeElem = document.querySelector('header div');
      data.type = typeElem ? typeElem.textContent.trim() : '';

      const membersElem = document.querySelector('div[data-testid="m_group_sections_members"]');
      if (membersElem) {
        data.members_text = membersElem.textContent.trim();
      }

      const aboutDiv = document.querySelector('._52jc._55wr');
      if (aboutDiv) {
        data.about = aboutDiv.textContent.trim();
      }

      return data;
    });

    if (groupData.members_text) {
      const match = groupData.members_text.match(/([\d,.KM]+)/);
      if (match) {
        groupData.members = parseAbbreviatedNumber(match[1]);
      }
    }

    groupData.id = group;
    return groupData;
  } finally {
    await page.close();
  }
}

// ----- Comment extraction helpers -----

async function loadAllComments(page) {
  const script = `
    (async () => {
      const KONTROL_PERIYODU = 700;
      const MAX_TIMEOUT = 7000;
      const MAX_DONGU = 15;
      const uyku = (ms) => new Promise(r => setTimeout(r, ms));

      function gaddarScroll() {
        window.scrollTo(0, document.body.scrollHeight);
        if (document.documentElement) {
          document.documentElement.scrollTop = document.documentElement.scrollHeight;
        }
        const tumDivler = document.querySelectorAll('div');
        tumDivler.forEach(div => {
          try {
            if (div.scrollHeight > div.clientHeight) {
              const style = window.getComputedStyle(div);
              if (style.overflowY === 'auto' || style.overflowY === 'scroll' || div.getAttribute('role') === 'dialog') {
                div.scrollTop = div.scrollHeight;
              }
            }
          } catch (e) {}
        });
        const tumYorumlar = document.querySelectorAll('div[role="article"]');
        if (tumYorumlar.length > 0) {
          tumYorumlar[tumYorumlar.length - 1].scrollIntoView({ block: "end", behavior: "auto" });
        } else {
          const dialogYorumlar = document.querySelectorAll('[role="dialog"] div[role="article"]');
          if (dialogYorumlar.length > 0) {
            dialogYorumlar[dialogYorumlar.length - 1].scrollIntoView({ block: "end", behavior: "auto" });
          }
        }
      }

      function butonlariTikla() {
        try {
          const container = document.querySelector('[role="dialog"]') || document;
          const butonlar = container.querySelectorAll('div[role="button"], span[role="button"]');
          let tiklamaYapildi = false;
          butonlar.forEach(btn => {
            const metin = btn.innerText ? btn.innerText.toLowerCase() : "";
            if (
              metin.includes("diğer yorumları gör") ||
              metin.includes("daha fazla yorum") ||
              metin.includes("yanıtı gör") ||
              metin.includes("yanıtları gör") ||
              metin.includes("view more comments") ||
              metin.includes("view replies")
            ) {
              btn.click();
              tiklamaYapildi = true;
            }
          });
          return tiklamaYapildi;
        } catch (e) {
          return false;
        }
      }

      for (let i = 1; i <= MAX_DONGU; i++) {
        try {
          const tumu = document.querySelectorAll('div[role="article"]');
          const dialogArt = document.querySelectorAll('[role="dialog"] div[role="article"]');
          const eskiYorumSayisi = tumu.length + dialogArt.length;
          gaddarScroll();
          const butonTiklandi = butonlariTikla();
          let gecenSure = 0;
          let yeniVeriGeldiMi = false;

          while (gecenSure < MAX_TIMEOUT) {
            await uyku(KONTROL_PERIYODU);
            gecenSure += KONTROL_PERIYODU;
            const yeni = document.querySelectorAll('div[role="article"]');
            const yeniDialog = document.querySelectorAll('[role="dialog"] div[role="article"]');
            const guncelYorumSayisi = yeni.length + yeniDialog.length;
            if (guncelYorumSayisi > eskiYorumSayisi) {
              yeniVeriGeldiMi = true;
              break;
            }
          }

          if (!yeniVeriGeldiMi && !butonTiklandi) break;
        } catch (e) {
          await uyku(1000);
        }
      }
    })()
  `;
  await page.evaluate(script);
}

const EXTRACT_SCRIPT = `
  (() => {
    const parseShortNumber = (str) => {
      if (!str) return 0;
      const m = str.replace(/,/g, '').trim().match(/^([\\d.]+)\\s*([KMBkmb]?)/);
      if (!m) return 0;
      const n = parseFloat(m[1]);
      const mod = m[2].toUpperCase();
      if (mod === 'K') return Math.round(n * 1000);
      if (mod === 'M') return Math.round(n * 1_000_000);
      if (mod === 'B') return Math.round(n * 1_000_000_000);
      return Math.round(n);
    };

    const extracted = [];
    const seen = new Set();

    const all = document.querySelectorAll('div[role="article"]');
    all.forEach(el => seen.add(el));

    document.querySelectorAll('[role="dialog"]').forEach(d => {
      d.querySelectorAll('div[role="article"]').forEach(el => seen.add(el));
    });

    const commentBlocks = [...seen];

    commentBlocks.forEach((block, index) => {
      try {
        const authorLink = block.querySelector('a[role="link"][href*="facebook.com"], a[role="link"][href^="/"]');
        const nameEl = block.querySelector('h4, a[role="link"] span, span[dir="auto"] strong');
        const bodyEl = block.querySelector('div[dir="auto"]');
        const timeEl = block.querySelector('a[role="link"] span[style*="white-space"]');
        const timeAnchor = block.querySelector('a[role="link"] time');

        if (!nameEl && !bodyEl) return;

        const name = authorLink ? authorLink.textContent.trim() : (nameEl ? nameEl.textContent.trim() : '');
        let profileUrl = authorLink ? authorLink.getAttribute('href') : '';
        if (profileUrl && profileUrl.startsWith('/')) {
          profileUrl = 'https://www.facebook.com' + profileUrl;
        }

        let username = '';
        if (authorLink && authorLink.href) {
          try {
            const urlObj = new URL(authorLink.href);
            let cleanPath = urlObj.pathname.replace(/^\\/+|\\/+$/g, '');
            if (cleanPath && cleanPath !== 'profile.php' && !cleanPath.includes('posts')) {
              username = cleanPath.split('/')[0];
            } else if (urlObj.searchParams.has('id')) {
              username = urlObj.searchParams.get('id');
            }
          } catch (e) {
            const parts = authorLink.href.split('/');
            username = parts[parts.length - 1] || '';
          }
        }

        const body = bodyEl ? bodyEl.textContent.trim() : '';
        const timeText = timeEl ? timeEl.textContent.trim() : '';
        const timeAttr = timeAnchor ? timeAnchor.getAttribute('datetime') || '' : '';

        let reactionCount = 0;
        const reactionEls = block.querySelectorAll(
          'span[aria-label*="Beğen"], span[aria-label*="Like"], ' +
          '[aria-label*="Beğen"], [aria-label*="Like"]'
        );
        for (const el of reactionEls) {
          const label = el.getAttribute('aria-label') || '';
          const numMatch = label.match(/([\\d,.KMBkmb]+)/);
          if (numMatch) {
            reactionCount = parseShortNumber(numMatch[1]);
            break;
          }
        }
        if (!reactionCount) {
          const textParts = block.textContent || '';
          const likeMatch = textParts.match(/([\\d,.KMBkmb]+)\\s*(Like|Beğen|beğenme|reaction)/i);
          if (likeMatch) {
            reactionCount = parseShortNumber(likeMatch[1]);
          }
        }

        let profilePicture = '';
        const img = block.querySelector('img[referrerpolicy="no-referrer"]');
        if (img) {
          const src = img.getAttribute('src') || '';
          if (src && !src.includes('emoji') && !src.includes('static.xx.fbcdn.net')) {
            profilePicture = src;
          }
        }

        extracted.push({
          id: index + 1,
          legacy_fbid: '',
          author: { name, id: username, profile_url: profileUrl },
          body,
          created_time: timeAttr || timeText,
          reaction_count: reactionCount,
          profile_picture: profilePicture,
        });
      } catch (e) {}
    });

    return extracted;
  })()
`;

async function dismissDialogs(page) {
  const fbSelectors = [
    'button[title="Allow all cookies"]',
    'button[title="Tüm çerezlere izin ver"]',
    'button[title="Tümünü Kabul Et"]',
    '[aria-label="Allow all cookies"]',
    '[aria-label="Tüm çerezlere izin ver"]',
  ];
  for (const sel of fbSelectors) {
    const found = await page.$(sel).catch(() => null);
    if (found) {
      await found.click().catch(() => {});
      return;
    }
  }
  await page.evaluate(() => {
    const patterns = [
      'allow all cookies', 'tüm çerezlere izin ver', 'tümünü kabul et',
      'accept all', 'allow cookies', 'allow', 'kabul et',
      'allow all', 'accept', 'izin ver',
    ];
    const els = document.querySelectorAll('[role="button"], button, a[role="button"], span[role="button"]');
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue;
      const t = (el.textContent || '').toLowerCase().trim();
      const l = (el.getAttribute('aria-label') || '').toLowerCase().trim();
      if (patterns.some(p => t.includes(p) || l.includes(p))) {
        el.click();
        return;
      }
    }
  });
}

async function setupFacebookSession(page, postUrl, cookies) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  });

  console.log('Loading facebook.com...');
  await page.goto('https://www.facebook.com/', { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  if (cookies) {
    const cookieList = await parseCookies(cookies);
    const hasLocale = cookieList.some(c => c.name === 'locale');
    if (!hasLocale) {
      cookieList.push({ name: 'locale', value: 'tr_TR', domain: '.facebook.com' });
    }
    if (cookieList.length > 0) {
      console.log(`Setting ${cookieList.length} cookies...`);
      await page.setCookie(...cookieList);
    }
  }

  await page.reload({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  let title = await page.title().catch(() => '');
  let finalUrl = page.url();
  console.log(`After cookie reload - Title: "${title}", URL: ${finalUrl}`);

  if (title === 'Facebook' || title.toLowerCase().includes('giriş')) {
    console.log('Consent page, dismissing dialogs...');
    await dismissDialogs(page);
    await new Promise(r => setTimeout(r, 3000));
    title = await page.title().catch(() => '');
    finalUrl = page.url();
    console.log(`After dismiss - Title: "${title}", URL: ${finalUrl}`);
  }

  return { title, finalUrl };
}

// ----- Adpost (Ads Library) scraping -----

const AD_EXTRACT_SCRIPT = `
  (() => {
    const ad = {};

    const advertiserEl = document.querySelector('a[href*="facebook.com"] span, h2, h3, [data-testid*="advertiser"]');
    if (advertiserEl) {
      ad.advertiser = advertiserEl.textContent.trim();
    }

    const headlineEl = document.querySelector('[data-testid*="headline"], [class*="headline"], strong, b');
    if (headlineEl) {
      ad.headline = headlineEl.textContent.trim();
    }

    const bodyEls = document.querySelectorAll('span, div[dir="auto"], [data-testid*="body"]');
    for (const el of bodyEls) {
      const text = el.textContent.trim();
      if (text.length > 30 && text.length < 2000) {
        ad.body_text = (ad.body_text || '') + text + '\\n';
      }
    }
    if (ad.body_text) ad.body_text = ad.body_text.trim();

    const ctaEl = document.querySelector('a[role="link"][tabindex="0"]');
    if (ctaEl) {
      const ctaText = ctaEl.textContent.trim();
      if (ctaText && ctaText.length < 100) {
        ad.cta = ctaText;
      }
    }

    const imgEl = document.querySelector('img[src*="fbcdn"], img[src*="scontent"]');
    if (imgEl) {
      ad.image = imgEl.getAttribute('src');
    }

    const allText = document.body.textContent || '';
    const dateMatch = allText.match(/(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},\s+\d{4})/);
    if (dateMatch) {
      ad.date = dateMatch[1];
    }

    const idMatch = allText.match(/Reklam ID[:\s]*([\d]+)/i) || allText.match(/Ad ID[:\s]*([\d]+)/i);
    if (idMatch) {
      ad.ad_id = idMatch[1];
    }

    return ad;
  })()
`;

async function extractPostUrlFromAdPage(page) {
  const result = await page.evaluate(() => {
    const allLinks = document.querySelectorAll('a[href*="facebook.com"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      if (
        href.includes('/posts/') ||
        href.includes('story_fbid=') ||
        href.includes('/permalink/') ||
        href.includes('/story.php') ||
        href.includes('/photos/') ||
        href.includes('/videos/')
      ) {
        return href.startsWith('http') ? href : 'https://www.facebook.com' + href;
      }
    }
    return null;
  });
  return result;
}

async function clickAdCommentsToggle(page) {
  return await page.evaluate(() => {
    const containers = document.querySelectorAll('div[role="dialog"] a, a, span, div[role="button"]');
    const patterns = [
      'yorumları gör', 'yorum', 'comment', 'comments',
      'view comments', 'gönderiyi görüntüle', 'view post',
      'tüm yorumlar', 'all comments',
    ];
    for (const el of containers) {
      if (!(el instanceof HTMLElement)) continue;
      const text = (el.textContent || '').toLowerCase().trim();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase().trim();
      for (const p of patterns) {
        if (text.includes(p) || aria.includes(p)) {
          el.click();
          return true;
        }
      }
    }
    return false;
  }).catch(() => false);
}

/**
 * Scrapes ad metadata + comments from a Facebook Ads Library URL.
 * Returns { ad: {...}, comments: [...] }
 */
export async function scrapeAdPost(browser, postUrl, options = {}) {
  const {
    cookies = null,
    debug = false,
    maxComments = 0,
  } = options;

  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    if (cookies) {
      const cookieList = await parseCookies(cookies);
      if (cookieList.length > 0) {
        console.log(`Setting ${cookieList.length} cookies...`);
        await page.setCookie(...cookieList);
      }
    }

    console.log(`[AdPost] Navigating to: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    const title = await page.title().catch(() => '');
    const finalUrl = page.url();
    console.log(`[AdPost] Title: "${title}", URL: ${finalUrl}`);

    const isLoginWall =
      title.toLowerCase().includes('log in') ||
      title.toLowerCase().includes('login') ||
      title.toLowerCase().includes('sign up') ||
      title.toLowerCase().includes('giriş') ||
      finalUrl.includes('/login') ||
      finalUrl.includes('login_via') ||
      finalUrl.includes('checkpoint');

    if (isLoginWall) {
      throw new Error(
        'Facebook oturum açma sayfasına yönlendirildi.\n' +
        'Reklam bilgilerini kazımak için geçerli Facebook çerezleri (cookies) gereklidir.\n' +
        `(Yönlendirilen URL: ${finalUrl})`
      );
    }

    if (debug) {
      const { writeFileSync } = await import('fs');
      const html = await page.content();
      writeFileSync('debug_adpost.html', html, 'utf-8');
      console.log('[debug] AdPost HTML kaydedildi → debug_adpost.html');
    }

    console.log('[AdPost] Extracting ad metadata...');
    const ad = await page.evaluate(AD_EXTRACT_SCRIPT).catch(() => ({}));
    ad.url = postUrl;
    console.log('[AdPost] Ad metadata:', JSON.stringify(ad, null, 2));

    let comments = [];

    console.log('[AdPost] Searching for underlying post URL...');
    const underlyingPostUrl = await extractPostUrlFromAdPage(page);

    if (underlyingPostUrl) {
      console.log(`[AdPost] Found underlying post URL: ${underlyingPostUrl}`);
      ad.underlying_post_url = underlyingPostUrl;

      await page.goto(underlyingPostUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      const postTitle = await page.title().catch(() => '');
      console.log(`[AdPost] Post page title: "${postTitle}"`);

      const postLoginWall =
        postTitle.toLowerCase().includes('log in') ||
        postTitle.toLowerCase().includes('login') ||
        postTitle.toLowerCase().includes('sign up') ||
        postTitle.toLowerCase().includes('giriş');

      if (!postLoginWall) {
        let raw = await page.evaluate(EXTRACT_SCRIPT).catch(() => []);
        if (Array.isArray(raw)) comments = raw;
        console.log(`[AdPost] Initial comments from post: ${comments.length}`);

        for (let i = 0; i < 10 && comments.length > 0; i++) {
          const clicked = await page.evaluate(() => {
            const container = document.querySelector('[role="dialog"]') || document;
            const spans = container.querySelectorAll('span');
            for (const span of spans) {
              const t = span.textContent.toLowerCase();
              if (t.includes('diğer yorumları gör') || t.includes('daha fazla yorum') || t.includes('view more comments')) {
                span.click();
                return true;
              }
            }
            return false;
          }).catch(() => false);

          if (!clicked) break;
          await new Promise(r => setTimeout(r, 1500));

          const raw2 = await page.evaluate(EXTRACT_SCRIPT).catch(() => []);
          const newComments = Array.isArray(raw2) ? raw2 : [];
          console.log(`[AdPost] After click ${i + 1}: ${newComments.length} comments`);
          comments = newComments;
        }
      }
    }

    if (comments.length === 0) {
      console.log('[AdPost] Trying direct extraction from Ads Library page...');

      const toggleClicked = await clickAdCommentsToggle(page);
      if (toggleClicked) {
        console.log('[AdPost] Comments toggle clicked');
        await new Promise(r => setTimeout(r, 2000));
      }

      await loadAllComments(page);
      await new Promise(r => setTimeout(r, 1000));

      const raw3 = await page.evaluate(EXTRACT_SCRIPT).catch(() => []);
      if (Array.isArray(raw3)) comments = raw3;
      console.log(`[AdPost] Comments from ad page: ${comments.length}`);
    }

    if (debug && comments.length === 0) {
      const { writeFileSync } = await import('fs');
      const html = await page.content();
      writeFileSync('debug_adpost_final.html', html, 'utf-8');
      console.log('[debug] Final AdPost HTML kaydedildi → debug_adpost_final.html');
    }

    const result = {
      ad,
      comments: maxComments > 0 ? comments.slice(0, maxComments) : comments,
      totalComments: comments.length,
      scrapedAt: new Date().toISOString(),
    };

    console.log(`[AdPost] Done. ${result.totalComments} comments extracted.`);
    return result;

  } finally {
    try { await page.close(); } catch (e) {}
  }
}

/**
 * Scrapes comments from a Facebook Ads Library URL (legacy, comments only).
 */
async function scrapeAdPostComments(browser, postUrl, options = {}) {
  const result = await scrapeAdPost(browser, postUrl, options);
  return result.comments;
}

// ----- Main comment scraping function (dispatches to normal or adpost) -----

export async function scrapePostComments(browser, postUrl, options = {}) {
  if (isAdsLibraryUrl(postUrl)) {
    console.log('Ads Library URL detected. Using adpost scraper.');
    return await scrapeAdPostComments(browser, postUrl, options);
  }

  const {
    cookies = null,
    debug = false,
    maxComments = 0,
  } = options;

  const isReel = postUrl.includes('/reel/');

  const run = async () => {
    const page = await browser.newPage();
    try {
      const { title, finalUrl } = await setupFacebookSession(page, postUrl, cookies);

      const isLoginWall =
        title.toLowerCase().includes('log in') ||
        title.toLowerCase().includes('login') ||
        title.toLowerCase().includes('sign up') ||
        title.toLowerCase().includes('giriş') ||
        finalUrl.includes('/login') ||
        finalUrl.includes('login_via') ||
        finalUrl.includes('checkpoint');

      if (isLoginWall) {
        throw new Error(
          'Facebook oturum açma sayfasına yönlendirildi.\n' +
          'Yorumları kazımak için geçerli Facebook çerezleri (cookies) gereklidir.\n' +
          `(Yönlendirilen URL: ${finalUrl})`
        );
      }

      console.log(`Navigating to target: ${postUrl}`);
      await page.goto(postUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 5000));

      let title2 = await page.title();
      let finalUrl2 = page.url();
      console.log(`After nav - Title: "${title2}", URL: ${finalUrl2}`);

      const isReelNav = isReel || finalUrl2.includes('/reel/');
      if (isReelNav) {
        console.log(`Reel URL detected. Final URL: ${finalUrl2}`);

        await new Promise(r => setTimeout(r, 3000));

        await page.evaluate(() => {
          const videos = document.querySelectorAll('video');
          videos.forEach(v => { try { v.pause(); } catch (e) {} });
        }).catch(() => {});

        const commentClicked = await page.evaluate(() => {
          const exactLabels = ['Yorum Yap', 'Yorumla', 'Comment', 'Yorumlar', 'Comments'];
          for (const label of exactLabels) {
            const el = document.querySelector(`[aria-label='${label}']`);
            if (el instanceof HTMLElement) {
              el.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);

        if (!commentClicked) {
          await page.evaluate(() => {
            const ariaLabels = [
              'yorum yap', 'yorumla', 'yorum', 'yoruma git',
              'comment', 'comments', 'yorumlar', 'yoruma',
            ];
            const candidates = document.querySelectorAll(
              '[role="button"], a[role="link"], [aria-label], span, div[role="button"]'
            );
            for (const el of candidates) {
              if (!(el instanceof HTMLElement)) continue;
              const label = (el.getAttribute('aria-label') || '').toLowerCase().trim();
              const text = (el.textContent || '').toLowerCase().trim();
              if (ariaLabels.some(a => label === a || label.includes(a) || text.includes(a))) {
                el.click();
                return;
              }
            }
          }).catch(() => {});
        }

        await new Promise(r => setTimeout(r, 3000));

        const hasArticles = await page.$('div[role="article"]').catch(() => null);
        if (!hasArticles) {
          await page.evaluate(() => {
            const links = document.querySelectorAll(
              'a[href*="comment"], a[href*="reel"][href*="reply"], [aria-label*="yorum" i], [aria-label*="comment" i]'
            );
            for (const el of links) {
              if (el instanceof HTMLElement) { el.click(); return; }
            }
          }).catch(() => {});
          await new Promise(r => setTimeout(r, 3000));
        }
        console.log('Comments toggle attempts finished');
      }

      await new Promise(r => setTimeout(r, 5000));

      let comments = await page.evaluate(EXTRACT_SCRIPT).catch(() => []);
      if (!Array.isArray(comments)) comments = [];
      console.log(`Initial comments: ${comments.length}`);

      if (comments.length > 0) {
        for (let i = 0; i < 30; i++) {
          const clicked = await page.evaluate(() => {
            const container = document.querySelector('[role="dialog"]') || document;
            const spans = container.querySelectorAll('span');
            for (const span of spans) {
              const t = span.textContent.toLowerCase();
              if (t.includes('diğer yorumları gör') || t.includes('daha fazla yorum') || t.includes('view more comments')) {
                span.click();
                return true;
              }
            }
            return false;
          }).catch(() => false);

          if (!clicked) break;

          await new Promise(r => setTimeout(r, 2000));

          const raw = await page.evaluate(EXTRACT_SCRIPT).catch(() => []);
          const newComments = Array.isArray(raw) ? raw : [];
          console.log(`After click ${i+1}: ${newComments.length} comments`);
          comments = newComments;
        }
      }

      if (comments.length === 0) {
        const { writeFileSync } = await import('fs');
        try {
          const html = await page.content();
          writeFileSync('debug_comments_before.html', html, 'utf-8');
          console.log('Saved debug_comments_before.html for inspection');
        } catch (e) {}
      }

      console.log(`Found ${comments.length} comments.`);
      return maxComments > 0 ? comments.slice(0, maxComments) : comments;
    } finally {
      try { await page.close(); } catch (e) {}
    }
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt === 2) throw err;
      if (err.message && (
        err.message.includes('Session closed') ||
        err.message.includes('Target closed') ||
        err.message.includes('Protocol error') ||
        err.message.includes('detached from frame')
      )) {
        console.log(`Connection lost (attempt ${attempt}), retrying...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
}
