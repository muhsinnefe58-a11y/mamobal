function showStatus(msg, type, isAd) {
  const el = document.getElementById(isAd ? 'adStatus' : 'status');
  el.textContent = msg;
  el.className = 'status show ' + type;
}

function showLoading(show, text) {
  document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
  if (text) document.getElementById('loadingText').textContent = text;
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');

  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');

  document.querySelectorAll('.results-panel').forEach(rp => rp.classList.remove('active'));
  document.getElementById(`results-${tab}`).classList.add('active');
}

// ----- GÖNDERİ ÇEKME -----

function renderComments(comments, postUrl) {
  const list = document.getElementById('commentsList');
  document.getElementById('commentCount').textContent = comments.length;

  if (!comments.length) {
    list.innerHTML = '<div class="empty-state"><p>Bu gönderiye ait yorum bulunamadı.</p></div>';
    return;
  }

  list.innerHTML = comments.map(c => {
    const profileUrl = c.authorProfileUrl || (c.authorId ? 'https://www.facebook.com/profile.php?id=' + c.authorId : '#');

    return '<div class="comment-item">' +
      '<div class="comment-header">' +
        '<a href="' + profileUrl + '" target="_blank" class="comment-author" title="Facebook profiline git">' +
          escapeHtml(c.authorName || 'Bilinmiyor') +
        '</a>' +
        (c.createdTime ? '<span class="comment-date">' + escapeHtml(c.createdTime) + '</span>' : '') +
      '</div>' +
      '<div class="comment-message">' + escapeHtml(c.message || '') + '</div>' +
      '<div class="comment-actions">' +
        '<a href="' + profileUrl + '" target="_blank" class="comment-action-btn">Yoruma Git</a>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function fetchComments() {
  const postUrl = document.getElementById('postUrl').value.trim();
  const sortBy = document.getElementById('sortBy').value;

  if (!postUrl) {
    showStatus('Lütfen bir Facebook gönderi URL\'si girin.', 'error', false);
    return;
  }

  showLoading(true, 'Yorumlar çekiliyor, bu 10-30 saniye sürebilir...');
  showStatus('', '', false);

  const cookies = document.getElementById('cookieInput')?.value?.trim() || '';

  try {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postUrl, cookies: cookies || undefined })
    });

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error('Sunucu hatası: ' + text.slice(0, 200));
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata');

    let comments = data.comments || [];
    if (sortBy === 'oldest') comments = comments.reverse();

    renderComments(comments, postUrl);
    showStatus(comments.length + ' yorum bulundu.', 'success', false);

  } catch (err) {
    showStatus('Hata: ' + err.message, 'error', false);
    document.getElementById('commentsList').innerHTML =
      '<div class="empty-state"><p>Hata oluştu</p><p style="font-size:12px;color:#c62828;">' +
      escapeHtml(err.message) + '</p></div>';
    document.getElementById('commentCount').textContent = '0';
  } finally {
    showLoading(false);
  }
}

// ----- REKLAM ÇEKME -----

function renderAdInfo(ad) {
  const container = document.getElementById('adInfoContent');
  const card = document.getElementById('adInfoCard');

  if (!ad || (!ad.advertiser && !ad.headline && !ad.bodyText)) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  let html = '<div class="ad-details">';

  if (ad.advertiser) {
    html += '<div class="ad-field"><span class="ad-label">Reklamveren</span><span class="ad-value">' + escapeHtml(ad.advertiser) + '</span></div>';
  }
  if (ad.headline) {
    html += '<div class="ad-field"><span class="ad-label">Başlık</span><span class="ad-value">' + escapeHtml(ad.headline) + '</span></div>';
  }
  if (ad.bodyText) {
    html += '<div class="ad-field"><span class="ad-label">Açıklama</span><span class="ad-value ad-body">' + escapeHtml(ad.bodyText) + '</span></div>';
  }
  if (ad.cta) {
    html += '<div class="ad-field"><span class="ad-label">Buton (CTA)</span><span class="ad-value ad-cta">' + escapeHtml(ad.cta) + '</span></div>';
  }
  if (ad.date) {
    html += '<div class="ad-field"><span class="ad-label">Tarih</span><span class="ad-value">' + escapeHtml(ad.date) + '</span></div>';
  }
  if (ad.adId) {
    html += '<div class="ad-field"><span class="ad-label">Reklam ID</span><span class="ad-value">' + escapeHtml(ad.adId) + '</span></div>';
  }
  if (ad.url) {
    html += '<div class="ad-field"><span class="ad-label">URL</span><a href="' + escapeHtml(ad.url) + '" target="_blank" class="ad-link">Ads Library'de Aç</a></div>';
  }
  if (ad.underlyingPostUrl) {
    html += '<div class="ad-field"><span class="ad-label">Gönderi</span><a href="' + escapeHtml(ad.underlyingPostUrl) + '" target="_blank" class="ad-link">Gönderiyi Aç</a></div>';
  }
  if (ad.image) {
    html += '<div class="ad-field"><span class="ad-label">Görsel</span><img src="' + escapeHtml(ad.image) + '" class="ad-image" alt="Reklam görseli"></div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderAdComments(comments) {
  const list = document.getElementById('adCommentsList');
  document.getElementById('adCommentCount').textContent = comments.length;

  if (!comments.length) {
    list.innerHTML = '<div class="empty-state"><p>Bu reklama ait yorum bulunamadı.</p></div>';
    return;
  }

  list.innerHTML = comments.map(c => {
    const profileUrl = c.authorProfileUrl || (c.authorId ? 'https://www.facebook.com/profile.php?id=' + c.authorId : '#');

    return '<div class="comment-item">' +
      '<div class="comment-header">' +
        '<a href="' + profileUrl + '" target="_blank" class="comment-author" title="Facebook profiline git">' +
          escapeHtml(c.authorName || 'Bilinmiyor') +
        '</a>' +
        (c.createdTime ? '<span class="comment-date">' + escapeHtml(c.createdTime) + '</span>' : '') +
      '</div>' +
      '<div class="comment-message">' + escapeHtml(c.message || '') + '</div>' +
      '<div class="comment-actions">' +
        '<a href="' + profileUrl + '" target="_blank" class="comment-action-btn">Yoruma Git</a>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function fetchAdPost() {
  const adUrl = document.getElementById('adUrl').value.trim();
  const sortBy = document.getElementById('adSortBy').value;

  if (!adUrl) {
    showStatus('Lütfen bir Facebook Reklam URL\'si girin.', 'error', true);
    return;
  }

  showLoading(true, 'Reklam bilgileri ve yorumlar çekiliyor, bu 15-40 saniye sürebilir...');
  showStatus('', '', true);

  const cookies = document.getElementById('cookieInput')?.value?.trim() || '';

  try {
    const res = await fetch('/api/adpost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: adUrl, cookies: cookies || undefined })
    });

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error('Sunucu hatası: ' + text.slice(0, 200));
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata');

    renderAdInfo(data.ad);

    let comments = data.comments || [];
    if (sortBy === 'oldest') comments = comments.reverse();

    renderAdComments(comments);
    showStatus(
      'Reklam bulundu. ' + (data.totalComments || comments.length) + ' yorum çekildi.',
      'success',
      true
    );

  } catch (err) {
    showStatus('Hata: ' + err.message, 'error', true);
    document.getElementById('adCommentsList').innerHTML =
      '<div class="empty-state"><p>Hata oluştu</p><p style="font-size:12px;color:#c62828;">' +
      escapeHtml(err.message) + '</p></div>';
    document.getElementById('adCommentCount').textContent = '0';
    document.getElementById('adInfoCard').style.display = 'none';
  } finally {
    showLoading(false);
  }
}

// ----- Init -----

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('postUrl').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') fetchComments();
  });
  document.getElementById('adUrl').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') fetchAdPost();
  });
});
