// Robot Ganti Seller Digiflazz
// Tempel di Console (F12) saat halaman Buyer Area > Produk terbuka.
// Memproses semua produk di tabel yang sedang tampil (hasil saringan, semua halaman).
(async () => {
  const LIVE = true;    // false = uji coba (hanya mencatat), true = ganti & simpan sungguhan
  const NILAI_MIN = 3.5;  // = filter "rating minimal" di modal Ubah Seller
  // = filter "rating qty" di modal Ubah Seller, dicoba berurutan: seller 20+ dulu (termurah dulu); bila seller 20+
  // habis (tidak ada, sudah dipakai baris lain, atau menolak) dilanjutkan ke seller 10+.
  const TINGKAT_ULASAN = [20, 10];
  const JEDA_MS = 700;
  const MAKS_DITOLAK = 3; // seller yang menolak (mis. wajib KTP) sebelum produk itu dilewati
  // Seller sudah dipasang di kode lain untuk produk yang sama -> coba seller termurah berikutnya (tidak dihitung MAKS_DITOLAK).
  const SUDAH_ADA = /sudah ada/i;
  // Seller yang menolak akun ini (wajib KTP), dilewati di semua produk. Hapus dari daftar bila KTP sudah diverifikasi Digiflazz.
  // Seller yang menolak dengan pesan cocok PENOLAKAN_AKUN ikut ditambahkan otomatis selama robot berjalan;
  // penolakan lain (mis. soal harga/produk) hanya berlaku untuk baris itu, produk lain tetap mencoba seller tsb.
  const sellerDilewati = new Set(['CV KENZIE KOMUNIKA']);
  const PENOLAKAN_AKUN = /ktp|verifikasi|identitas/i;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Galat dari $http Digiflazz berbentuk respons: { status, data: { message } }.
  const statusGalat = e => e.status ?? e.response?.status;
  const pesanGalat = e => e.data?.message || e.response?.data?.message || e.message || '';
  // 429 = terlalu cepat: tunggu lalu coba lagi, maksimal 5 kali.
  const kirim = async fn => {
    for (let coba = 1; ; coba++) {
      try { return await fn(); }
      catch (e) { if (statusGalat(e) !== 429 || coba >= 5) throw e; await sleep(15000 * coba); }
    }
  };

  // Seller dengan Nilai >= NILAI_MIN, jumlah ulasan >= ulasanMin dan stok tidak 0, termurah dulu; harga sama -> Nilai tertinggi.
  // rating_qty berupa teks rentang ("60+", "20+", "10-19"); parseInt mengambil angka awalnya.
  // Status 1 / -6 = seller yang boleh disimpan menurut halaman Digiflazz sendiri.
  // ponytail: syarat Multi "Ya" ditunda pemilik (2026-10-18); bila diaktifkan: s.multi && s.connectionType !== 'jabber'.
  const saringSeller = (sellers, ulasanMin) => sellers
    .filter(s => Number(s.reviewAvg) >= NILAI_MIN && parseInt(s.rating_qty) >= ulasanMin &&
      (s.unlimited_stock || s.stock > 0) && [1, -6].includes(s.status_sellerSku))
    .sort((a, b) => a.price - b.price || b.reviewAvg - a.reviewAvg);

  const ok = { unlimited_stock: true, status_sellerSku: 1, rating_qty: '60+' };
  const contoh = [
    { ...ok, price: 2000, reviewAvg: 0 },
    { ...ok, price: 2050, reviewAvg: 3.4 },
    { ...ok, price: 2100, reviewAvg: 4.8, rating_qty: '10-19' },
    { ...ok, price: 2150, reviewAvg: 4.8, rating_qty: null },
    { ...ok, price: 2180, reviewAvg: 4.8, rating_qty: '1-9' },
    { ...ok, price: 2200, reviewAvg: 4.5, unlimited_stock: false, stock: 0 },
    { ...ok, price: 2320, reviewAvg: 3.6, rating_qty: '20+' },
    { ...ok, price: 2320, reviewAvg: 4.9 },
    { ...ok, price: 2500, reviewAvg: 5 },
  ];
  console.assert(saringSeller(contoh, 20).map(s => s.reviewAvg).join() === '4.9,3.6,5', 'saringSeller 20+ rusak');
  console.assert(saringSeller(contoh, 10).map(s => s.reviewAvg).join() === '4.8,4.9,3.6,5', 'saringSeller 10+ rusak');

  const tombol = document.querySelector('.el-table__body .el-button.table-fullwidth');
  if (!tombol) return console.error('Buka halaman Buyer Area > Produk dulu.');
  let tabel = tombol.__vue__; while (tabel && !tabel.$options.methods?.selectSeller) tabel = tabel.$parent;
  let dt = tombol.__vue__; while (dt && dt.$options.name !== 'DataTables') dt = dt.$parent;

  // Ubah baris lalu simpan (= tombol centang); gagal simpan -> baris dikembalikan seperti semula.
  const simpan = async (p, ubah) => {
    const asli = { ...p };
    try {
      ubah();
      await kirim(() => tabel.$http.post('/buyer/product', p));
      p.change = false;
    } catch (e) {
      Object.assign(p, asli);
      throw e;
    }
  };

  // Diproses urut seperti di tabel: untuk produk yang sama, baris atas dapat seller termurah,
  // baris berikutnya dapat termurah berikutnya (seller yang sudah dipakai baris di atasnya dilewati).
  const produk = [...dt.tableData];
  const dipakai = {}; // nama produk -> Map(seller -> kode yang memakainya)
  const hasil = window.hasilGantiSeller = [];
  const ulasanTerendah = TINGKAT_ULASAN[TINGKAT_ULASAN.length - 1];
  console.log(`${LIVE ? 'JALAN SUNGGUHAN' : 'UJI COBA'}: ${produk.length} produk, ulasan ${TINGKAT_ULASAN.map(n => n + '+').join(' lalu ')}`);

  for (const [i, p] of produk.entries()) {
    const baris = { kode: p.code, produk: p.product, sellerLama: p.seller, hargaLama: p.price || '-' };
    const dipakaiProduk = dipakai[p.product] ||= new Map();
    try {
      const { data } = await kirim(() => tabel.$http.get('/buyer/product/seller/' + p.id)); // = klik Ubah Seller
      // Urutan terbaik: semua seller lolos standar ulasan tertinggi (termurah dulu), lalu tambahan dari standar berikutnya.
      const urutan = [];
      for (const ulasanMin of TINGKAT_ULASAN)
        for (const s of saringSeller(data.data, ulasanMin))
          if (!urutan.some(u => u.s === s)) urutan.push({ s, standar: ulasanMin + '+' });
      const lolos = urutan.filter(u => !sellerDilewati.has(u.s.seller));
      const kandidat = lolos.filter(u => !dipakaiProduk.has(u.s.seller));
      // Seller yang memenuhi syarat tapi dilewati karena menolak akun ini.
      const terlewati = [...new Set(urutan.filter(u => sellerDilewati.has(u.s.seller)).map(u => u.s.seller))];
      if (!lolos.length) baris.hasil = terlewati.length
        ? `Seller yang memenuhi syarat dilewati (menolak akun ini): ${terlewati.join(', ')}`
        : `Tidak ada seller Nilai >= ${NILAI_MIN} & ulasan ${ulasanTerendah}+`;
      else if (!kandidat.length) baris.hasil = `Tidak ada seller tersisa: semua dipakai ${[...dipakaiProduk.values()].join(', ')}`;
      const patokan = p.price; // harga seller sekarang, hanya untuk laporan hemat (minus = lebih mahal)

      // Biasanya hanya kandidat pertama; kandidat berikutnya dicoba hanya bila seller menolak saat disimpan.
      const sudahAda = new Set(); // seller yang dipakai kode lain produk ini (ketahuan saat simpan ditolak)
      let ditolakLain = 0;
      for (const { s, standar } of kandidat) {
        if (sudahAda.has(s.seller)) continue; // SKU lain dari seller yang sama
        const baru = { sellerBaru: s.seller, nilai: s.reviewAvg, ulasan: s.rating_qty, standarUlasan: standar, hargaBaru: s.price, hemat: patokan ? patokan - s.price : '' };
        // Semua baris diganti ke seller terbaik yang lolos saringan, walau lebih mahal dari seller sekarang.
        if (s.seller === p.seller) {
          baris.hasil = 'Sudah seller terbaik';
          baris.standarUlasan = standar;
          if (!p.status) {
            if (LIVE) await simpan(p, () => { p.status = true; }); // = saklar Status ON + centang
            baris.hasil += LIVE ? ', status DINYALAKAN' : ', status AKAN DINYALAKAN';
          }
          break;
        }
        if (!LIVE) {
          Object.assign(baris, baru, { hasil: 'AKAN DIGANTI' });
          break;
        }
        try {
          await simpan(p, () => {
            tabel.currentEditted = p;
            tabel.selectSeller(s); // = klik Pilih
            p.status = true;       // = saklar Status ON
          });
          Object.assign(baris, baru, { hasil: 'DIGANTI' });
          break;
        } catch (e) {
          if (statusGalat(e) !== 400) throw e;
          const pesan = pesanGalat(e);
          (baris.ditolak ||= []).push(`${s.seller}: ${pesan}`);
          await sleep(JEDA_MS);
          if (SUDAH_ADA.test(pesan)) { sudahAda.add(s.seller); continue; }
          if (PENOLAKAN_AKUN.test(pesan)) sellerDilewati.add(s.seller);
          if (++ditolakLain >= MAKS_DITOLAK) { baris.hasil = `GAGAL: ${MAKS_DITOLAK} seller menolak`; break; }
        }
      }
      baris.hasil ||= !ditolakLain && sudahAda.size
        ? `Tidak ada seller tersisa: ${[...sudahAda].join(', ')} sudah dipakai kode lain produk ini`
        : 'GAGAL: semua seller menolak';
      if (p.max_price > 0 && baris.hargaBaru > p.max_price) baris.lewatHargaMax = p.max_price;
    } catch (e) {
      baris.hasil = `GAGAL (${statusGalat(e) ?? '-'}): ${pesanGalat(e)}`;
    }
    // Seller akhir baris ini (baru, atau lama bila tidak diganti) tidak boleh dipakai baris di bawahnya.
    const sellerAkhir = baris.sellerBaru || (p.price && p.seller);
    if (sellerAkhir) dipakaiProduk.set(sellerAkhir, p.code);
    hasil.push(baris);
    const tanda = baris.standarUlasan && baris.standarUlasan !== TINGKAT_ULASAN[0] + '+' ? ` [ulasan ${baris.standarUlasan}]` : '';
    console.log(`[${i + 1}/${produk.length}] ${p.code}: ${baris.hasil}${tanda}${baris.ditolak ? ' | ditolak: ' + baris.ditolak.join(' ; ') : ''}`);
    await sleep(JEDA_MS);
  }

  console.table(hasil);

  // Perbandingan harga sebelum vs sesudah (uji coba: sesudah = rencana).
  const diganti = hasil.filter(b => b.sellerBaru);
  const punyaHarga = diganti.filter(b => b.hargaLama !== '-');
  const jumlah = (rows, k) => rows.reduce((a, b) => a + b[k], 0);
  const rp = n => 'Rp ' + n.toLocaleString('id-ID');
  console.table({
    'Ganti seller (hemat minus = lebih mahal)': {
      produk: punyaHarga.length,
      'total sebelum': rp(jumlah(punyaHarga, 'hargaLama')),
      'total sesudah': rp(jumlah(punyaHarga, 'hargaBaru')),
      hemat: rp(jumlah(punyaHarga, 'hemat')),
    },
    'Invalid Seller diberi seller': {
      produk: diganti.length - punyaHarga.length,
      'total sebelum': '-',
      'total sesudah': rp(jumlah(diganti, 'hargaBaru') - jumlah(punyaHarga, 'hargaBaru')),
      hemat: '-',
    },
  });
  console.table(Object.fromEntries(TINGKAT_ULASAN.map(n => [`Standar ulasan ${n}+`, {
    produk: hasil.filter(b => b.standarUlasan === n + '+').length,
    diganti: diganti.filter(b => b.standarUlasan === n + '+').length,
  }])));

  // Unduh perbandingan per produk sebagai CSV (pemisah ; untuk Excel Indonesia).
  const kolom = ['kode', 'produk', 'sellerLama', 'hargaLama', 'sellerBaru', 'nilai', 'ulasan', 'standarUlasan', 'hargaBaru', 'hemat', 'hasil', 'ditolak', 'lewatHargaMax'];
  const csv = '﻿' + [kolom.join(';'), ...hasil.map(b => kolom.map(k => String(b[k] ?? '').replace(/[;\r\n]/g, ',')).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `perbandingan-harga-${LIVE ? 'sungguhan' : 'ujicoba'}-${new Date().toLocaleString('sv').slice(0, 16).replace(/[ :]/g, '-')}.csv`;
  a.click();
  console.log(`Perbandingan per produk diunduh: ${a.download}. Data juga ada di variabel hasilGantiSeller.`);
})();
