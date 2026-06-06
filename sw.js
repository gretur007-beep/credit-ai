// =============================================
// SERVICE WORKER - Asisten Kredit Gadget PWA
// Handles: background notifications, offline cache
// =============================================

const CACHE_NAME = 'kredit-gadget-v1';
const ASSETS = ['./index.html', './manifest.json'];

// ── Install: cache aset utama ──────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// ── Activate: hapus cache lama ─────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// ── Fetch: layani dari cache jika offline ──────
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});

// ── Push: terima pesan dari server (opsional) ──
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    event.waitUntil(
        self.registration.showNotification(data.title || 'Pengingat Kredit', {
            body: data.body || 'Ada tagihan yang perlu diperhatikan.',
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: 'kredit-notif',
            renotify: true,
            vibrate: [200, 100, 200],
            data: { url: data.url || './' }
        })
    );
});

// ── Notification Click: buka app ───────────────
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes('index.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            return clients.openWindow('./index.html');
        })
    );
});

// ── Periodic Background Sync: cek jatuh tempo ─
// (Didukung Chrome Android >= 80)
self.addEventListener('periodicsync', event => {
    if (event.tag === 'cek-jatuh-tempo') {
        event.waitUntil(cekDanKirimNotifJatuhTempo());
    }
});

// ── Background Sync fallback ───────────────────
self.addEventListener('sync', event => {
    if (event.tag === 'cek-jatuh-tempo') {
        event.waitUntil(cekDanKirimNotifJatuhTempo());
    }
});

// ── Fungsi Cek Jatuh Tempo ─────────────────────
async function cekDanKirimNotifJatuhTempo() {
    try {
        // Ambil data pelanggan dari IndexedDB / broadcast ke client
        const clientList = await clients.matchAll({ includeUncontrolled: true });

        // Minta data dari client yang aktif
        for (const client of clientList) {
            client.postMessage({ type: 'MINTA_DATA_JATUH_TEMPO' });
        }

        // Jika tidak ada client aktif, baca dari cache message
        const cache = await caches.open(CACHE_NAME);
        const dataRes = await cache.match('__jatuh_tempo_data__');
        if (!dataRes) return;

        const { pelanggan } = await dataRes.json();
        if (!pelanggan || pelanggan.length === 0) return;

        const tglHariIni = new Date().getDate();
        const h5List = pelanggan.filter(p => {
            const selisih = parseInt(p.tglJatuhTempo) - tglHariIni;
            return selisih >= 0 && selisih <= 5;
        });

        if (h5List.length === 0) return;

        const namaList = h5List.map(p => `${p.nama} (H-${parseInt(p.tglJatuhTempo) - tglHariIni})`).join(', ');

        await self.registration.showNotification('⏰ Pengingat Jatuh Tempo', {
            body: `${h5List.length} pelanggan akan jatuh tempo: ${namaList}`,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: 'jatuh-tempo',
            renotify: true,
            vibrate: [300, 100, 300, 100, 300],
            actions: [
                { action: 'buka', title: '📋 Lihat Detail' },
                { action: 'tutup', title: 'Tutup' }
            ]
        });
    } catch (e) {
        console.error('[SW] Gagal cek jatuh tempo:', e);
    }
}

// ── Terima data dari app untuk disimpan di cache ─
self.addEventListener('message', async event => {
    if (event.data && event.data.type === 'SIMPAN_DATA_JATUH_TEMPO') {
        const cache = await caches.open(CACHE_NAME);
        const res = new Response(JSON.stringify({ pelanggan: event.data.pelanggan }), {
            headers: { 'Content-Type': 'application/json' }
        });
        await cache.put('__jatuh_tempo_data__', res);
    }

    if (event.data && event.data.type === 'KIRIM_NOTIF_SEKARANG') {
        const { title, body } = event.data;
        await self.registration.showNotification(title || '⏰ Pengingat', {
            body: body || '',
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: 'manual-notif',
            vibrate: [200, 100, 200]
        });
    }
});
