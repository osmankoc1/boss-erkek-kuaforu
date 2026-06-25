export const metadata = { title: "Kullanım Rehberi — BOSS Admin" };

const sections = [
  {
    id: "giris",
    title: "1. Panele Giriş",
    icon: "🔑",
    content: [
      {
        heading: "Admin paneline nasıl girilir?",
        steps: [
          'Tarayıcınıza sitenizin adresini yazın ve sonuna "/admin/login" ekleyin. Örnek: siteadi.com/admin/login',
          '"E-posta" kutusuna kayıtlı e-posta adresinizi yazın.',
          '"Şifre" kutusuna şifrenizi yazın.',
          '"Giriş Yap" butonuna basın. Birkaç saniye içinde dashboard sayfası açılır.',
          'Yanlış bilgi girerseniz ekranda kırmızı bir hata mesajı çıkar. Bilgilerinizi kontrol edip tekrar deneyin.',
        ],
      },
      {
        heading: "Çıkış nasıl yapılır?",
        steps: [
          'Sol menünün en altında "Çıkış Yap" yazısını göreceksiniz.',
          'O butona basın. Oturumunuz kapanır ve giriş ekranına yönlendirilirsiniz.',
        ],
      },
    ],
  },
  {
    id: "dashboard",
    title: "2. Dashboard Nasıl Okunur?",
    icon: "📊",
    content: [
      {
        heading: "Sayfa ne gösterir?",
        steps: [
          '"Bugünkü Satış": Bugün kasa kaydettiğiniz toplam satış tutarıdır.',
          '"Tahsilat": Bugün gerçekten tahsil ettiğiniz (nakit veya kart aldığınız) paradır.',
          '"Veresiye": Bugün veresiye bırakılan, henüz tahsil edilmemiş toplam tutardır.',
          '"Bu Ay Satış": Bu ayın başından bugüne kadar yapılan toplam satıştır.',
          '"Bekleyen Randevular": Onay verilmemiş ya da tamamlanmamış randevuları gösterir.',
        ],
      },
      {
        heading: "Grafikleri nasıl okurum?",
        steps: [
          'Çubuk grafik: Hangi saatlerde daha çok müşteri geldiğini gösterir.',
          'Alan grafik: Son 30 günde randevu sayısının değişimini gösterir.',
          'Bu grafikler sayesinde yoğun günlerinizi ve saatlerinizi kolayca görebilirsiniz.',
        ],
      },
    ],
  },
  {
    id: "randevular",
    title: "3. Randevu Yönetimi",
    icon: "📅",
    content: [
      {
        heading: "Yeni randevu nasıl oluşturulur?",
        steps: [
          'Sol menüden "Randevular" bağlantısına tıklayın.',
          'Sayfanın sağ üst köşesindeki turuncu "Yeni Randevu" butonuna basın.',
          'Açılan pencerede müşteri seçim yöntemini belirleyin: "Müşteri Ara" (kayıtlı müşteri), "Yeni Müşteri" (yeni kayıt), veya "Manuel" (ad-telefon yazın).',
          '"Hizmet" kutusundan sunulacak hizmeti seçin.',
          '"Çalışan" kutusundan ilgili berberi seçin.',
          '"Tarih" kutusuna randevu tarihini seçin.',
          '"Saat" kutusuna başlangıç saatini yazın (örn: 10:30). Bitiş saati otomatik olarak hesaplanır.',
          '"Kaydet" butonuna basın. Randevu takvimde görünür.',
        ],
      },
      {
        heading: "Randevu nasıl onaylanır, iptal edilir, tamamlanır?",
        steps: [
          '"Onayla" butonu: Randevuyu bekleme durumundan onaylı duruma geçirir.',
          '"İptal" butonu: Randevuyu iptal eder. Kasa kaydı oluşmaz.',
          '"Tamamla" butonu: Randevuyu tamamlar ve kasa kaydı oluşturma ekranını açar.',
        ],
      },
      {
        heading: "Takvim görünümü nasıl kullanılır?",
        steps: [
          'Sağ üstteki görünüm butonlarından "Liste", "Günlük" veya "Haftalık" seçeneğini seçin.',
          'Günlük görünümde saat dilimlerine göre randevuları görebilirsiniz.',
          'Haftalık görünümde o haftanın tüm randevuları bir arada görünür.',
          'Tarih filtresiyle istediğiniz güne atlayabilirsiniz.',
        ],
      },
    ],
  },
  {
    id: "kasa-aktarma",
    title: "4. Randevudan Kasa Kaydı Oluşturma",
    icon: "💳",
    content: [
      {
        heading: '"Tamamla" butonuna basınca ne olur?',
        steps: [
          '"Tamamla" butonuna bastığınızda önce ödeme ekranı açılır.',
          'Ekranda müşteri adı ve hizmet adı otomatik gelir.',
          '"Satış ₺" kutusunda hizmetin fiyatı yazar. İsterseniz değiştirebilirsiniz.',
          '"Ödenen ₺" kutusuna müşterinin verdiği parayı yazın.',
          '"Kalan ₺" kutusu otomatik hesaplanır, elle yazamazsınız.',
          'Ödeme yöntemini seçin: "Nakit", "Kart", "Havale" veya "Diğer".',
          'İsterseniz "Not" kutusuna açıklama yazın.',
          '"Kaydet & Tamamla" butonuna basın. Randevu tamamlanır, kasa kaydı oluşur.',
        ],
      },
      {
        heading: "Müşteri ödeme yapmadıysa ne yapılır?",
        steps: [
          '"Ödenen ₺" kutusuna 0 yazın.',
          'Sistem bu kaydı otomatik olarak "Veresiye" olarak işaretler.',
          'Müşteri daha sonra ödeme yaptığında "Veresiye Defteri" üzerinden tahsilat yapabilirsiniz.',
        ],
      },
      {
        heading: "Kısmi ödeme nasıl girilir?",
        steps: [
          'Örnek: Satış tutarı 300 ₺, müşteri 100 ₺ verdi.',
          '"Satış ₺" kutusuna 300 yazın.',
          '"Ödenen ₺" kutusuna 100 yazın.',
          '"Kalan ₺" otomatik 200 gösterir.',
          'Kaydedin. Sistem bu kaydı "Kısmi Ödeme" olarak işaretler ve veresiyeye düşer.',
        ],
      },
    ],
  },
  {
    id: "kasa",
    title: "5. Günlük Kasa Kullanımı",
    icon: "🏧",
    content: [
      {
        heading: "Yeni satış nasıl girilir?",
        steps: [
          'Sol menüden "Günlük Kasa" bağlantısına tıklayın.',
          'Sayfanın sağ üst köşesindeki turuncu "Yeni Satış" butonuna basın.',
          'Açılan pencerede müşteri seçin: "Müşteri Ara" (kayıtlı müşteri arayın), "Yeni Müşteri" (ad ve telefon girin, sistem kayıt oluşturur), veya "Manuel" (sadece o satış için ad-telefon yazın, kalıcı kayıt olmaz).',
          '"Hizmet" açılır menüsünden hizmeti seçin. Fiyat otomatik gelir.',
          '"Çalışan" açılır menüsünden berberi seçin.',
          '"Satış Tutarı ₺" kutusuna tutarı yazın (hizmet fiyatı otomatik gelir ama değiştirebilirsiniz).',
          '"Ödenen Tutar ₺" kutusuna tahsil ettiğiniz parayı yazın.',
          '"Kalan ₺" otomatik hesaplanır.',
          'Ödeme yöntemini seçin: "Nakit", "Kart", "Havale", "Diğer".',
          'İsteğe bağlı not yazabilirsiniz.',
          '"Kaydet" butonuna basın.',
        ],
      },
      {
        heading: "Satış nasıl iptal edilir?",
        steps: [
          'Tablo satırının sağ tarafındaki "Void" (kırmızı) butonuna basın.',
          'Onay sorusu gelir. "Tamam" derseniz satış iptal edilir.',
          'İptal edilen satış gri renkte tabloda görünmeye devam eder ama toplamlardan düşer.',
        ],
      },
      {
        heading: "Çalışan filtresi nasıl kullanılır?",
        steps: [
          'Sayfanın üst kısmındaki "Tüm Çalışanlar" açılır menüsüne tıklayın.',
          'Bir berber seçin. Tablo ve özet kartlar yalnızca o berbere ait satışları gösterir.',
          '"Tüm Çalışanlar" seçeneğine dönünce filtre kalkar.',
        ],
      },
    ],
  },
  {
    id: "veresiye",
    title: "6. Veresiye Defteri",
    icon: "📒",
    content: [
      {
        heading: "Veresiye nedir? Veresiyeli kayıtlar nerede görülür?",
        steps: [
          'Veresiye: Müşterinin hizmetten yararlandığı ama parasını henüz ödemediği durumdur.',
          'Kısmi ödeme: Müşterinin tutarın bir kısmını ödediği, kalanın borç olarak kaldığı durumdur.',
          'Sol menüden "Veresiye Defteri" bağlantısına tıklayın.',
          'Bu sayfada tüm açık borçlar listelenir: müşteri adı, kaç gündür borçlu olduğu, kalan tutar.',
        ],
      },
      {
        heading: "Ödeme nasıl alınır?",
        steps: [
          'İlgili müşteri satırının sağındaki turuncu "Ödeme Al" butonuna basın.',
          'Açılan pencerede "Tutar ₺" kutusuna alınan parayı yazın.',
          'Ödeme yöntemini seçin.',
          'İsteğe bağlı not ekleyin.',
          '"Kaydet" butonuna basın. Kalan borç güncellenir.',
          'Borç tamamen kapanırsa kayıt listeden otomatik olarak düşer.',
        ],
      },
    ],
  },
  {
    id: "gun-sonu",
    title: "7. Gün Sonu Kullanımı",
    icon: "🌙",
    content: [
      {
        heading: "Gün sonu ekranı ne işe yarar?",
        steps: [
          'Sol menüden "Gün Sonu" bağlantısına tıklayın.',
          'Bu ekran günün tüm kasa özetini gösterir.',
          '"Toplam Satış": Bugün yapılan tüm satışların toplamı.',
          '"Toplam Tahsilat": Bugün gerçekten tahsil edilen para.',
          '"Toplam Gider": Bugün eklediğiniz giderlerin (kira, elektrik, malzeme vb.) toplamı.',
          '"Net Kasa": Tahsilat eksi Gider. Günün sonu elinizde kalan para.',
          '"Veresiye": Bugün veresiyede bırakılan toplam tutar.',
        ],
      },
      {
        heading: "Gider nasıl eklenir ve silinir?",
        steps: [
          'Sayfanın gider bölümündeki "Gider Ekle" butonuna basın.',
          'Kategori seçin: Kira, Elektrik, Malzeme, Diğer.',
          'Tutarı yazın.',
          'İsteğe bağlı açıklama ekleyin.',
          '"Kaydet" butonuna basın. Net Kasa otomatik güncellenir.',
          'Yanlış girdiğiniz gideri silmek için satır sonundaki çöp kutusu ikonuna basın.',
        ],
      },
      {
        heading: "Çalışan tablosu nasıl okunur?",
        steps: [
          'Her çalışanın o gün kaç işlem yaptığı, toplam satışı ve çalışan payı ayrı ayrı gösterilir.',
          '"Çalışan Payı": O berberin kazandığı komisyon tutarı.',
          '"İşletme Payı": Komisyon düşüldükten sonra işletmeye kalan tutar.',
        ],
      },
    ],
  },
  {
    id: "hakedisler",
    title: "8. Hakedişler",
    icon: "💰",
    content: [
      {
        heading: "Hakediş nedir?",
        steps: [
          'Hakediş: Berberin o dönemde yaptığı işlemler üzerinden hesaplanan kazancıdır.',
          '"OWNER" (Sahip/Patron): Hakediş 0 ₺ gösterir. Tüm gelir işletmeye aittir.',
          '"COMMISSION" (Yüzdeli): Satış tutarının belirlenen yüzdesi berbere aittir. Örneğin %50 için 300 ₺ satışta 150 ₺ hakediş.',
          '"FIXED_SALARY" (Sabit Maaşlı): Hakediş 0 ₺ gösterir. Maaş ayrıca anlaşılır.',
        ],
      },
      {
        heading: "Tarih filtresi ve özel tarih aralığı nasıl kullanılır?",
        steps: [
          'Sayfanın üstündeki butonlardan "Bugün", "Dün", "Bu Hafta", "Bu Ay" seçeneklerinden birine tıklayın.',
          'Özel bir tarih aralığı için "Özel" butonuna tıklayın.',
          'Açılan "Başlangıç" ve "Bitiş" tarih kutularına istediğiniz tarihleri seçin.',
          '"Uygula" butonuna basın. Tablo o aralığı gösterir.',
        ],
      },
    ],
  },
  {
    id: "calisanlar",
    title: "9. Çalışan Yönetimi",
    icon: "👤",
    content: [
      {
        heading: "Yeni çalışan nasıl eklenir?",
        steps: [
          'Sol menüden "Çalışanlar" bağlantısına tıklayın.',
          '"Yeni Çalışan Ekle" butonuna basın.',
          '"Ad" kutusuna çalışanın adını yazın.',
          '"Çalışma Tipi" menüsünden seçin: "Sahip/Patron", "Yüzdeli", "Sabit Maaşlı".',
          '"Yüzdeli" seçtiyseniz "Komisyon Oranı %" kutusuna yüzdeyi yazın (örn: 50).',
          '"Takvim Rengi" kutusundan bir renk seçin. Randevu takviminde bu renk kullanılır.',
          '"Kaydet" butonuna basın.',
        ],
      },
      {
        heading: "Çalışan nasıl aktif/pasif yapılır?",
        steps: [
          'Çalışanlar listesinde ilgili kişinin kartındaki "Aktif/Pasif" düğmesine basın.',
          'Pasif yapılan çalışan randevu ve kasa formlarında görünmez ama geçmiş kayıtları korunur.',
        ],
      },
      {
        heading: "Çalışan profili nasıl düzenlenir?",
        steps: [
          'Çalışanlar listesinden çalışanın adına veya "Detay" bağlantısına tıklayın.',
          'Açılan sayfada "Profili Düzenle" butonuna basın.',
          'Ad, uzmanlık, deneyim yılı, biyografi ve takvim rengini düzenleyebilirsiniz.',
          '"Kaydet" butonuna basın.',
        ],
      },
    ],
  },
  {
    id: "musteriler",
    title: "10. Müşteri Yönetimi",
    icon: "👥",
    content: [
      {
        heading: "Müşteri nasıl aranır ve detayına nasıl girilir?",
        steps: [
          'Sol menüden "Müşteriler" bağlantısına tıklayın.',
          'Arama kutusuna müşterinin adını veya telefon numarasını yazıp "Filtrele" butonuna basın.',
          'Listede ilgili müşteriye ulaştığınızda satırın sağındaki "Detay" bağlantısına tıklayın.',
        ],
      },
      {
        heading: "Müşteri ekstresi nasıl okunur?",
        steps: [
          '"Müşteri Ekstresi" tablosunda her satış ve tahsilat tarih sırasıyla listelenir.',
          '"Borç" sütunu: O işlemde müşteriden alacaklı olunan tutardır.',
          '"Alacak" sütunu: O işlemde yapılan ödemedir.',
          '"Bakiye" sütunu: O ana kadar birikmiş açık borçtur. Sıfırsa borcun olmadığı anlamına gelir.',
        ],
      },
      {
        heading: "Aynı müşteri iki kere kaydolduysa nasıl birleştirilir?",
        steps: [
          'Ana müşterinin detay sayfasına girin.',
          '"Müşteri Birleştir" butonuna basın.',
          'Açılan arama kutusuna birleştirmek istediğiniz müşterinin adını veya telefonunu yazın.',
          'Listeden doğru müşteriyi seçin.',
          'Önizleme ekranında iki müşterinin ortak geçmişi gösterilir.',
          '"Birleştir ve Devam Et" butonuna basın.',
          'İkinci kayıt artık listede görünmez; tüm satış ve randevu geçmişi ana müşteride toplanır.',
        ],
      },
    ],
  },
  {
    id: "hizmetler",
    title: "11. Hizmet Yönetimi",
    icon: "✂️",
    content: [
      {
        heading: "Yeni hizmet nasıl eklenir?",
        steps: [
          'Sol menüden "Hizmetler" bağlantısına tıklayın.',
          '"Yeni Hizmet" butonuna basın.',
          '"Hizmet Adı" kutusuna adı yazın (örn: Saç Kesimi).',
          '"Süre (dk)" kutusuna dakika cinsinden süreyi yazın (örn: 30).',
          '"Fiyat ₺" kutusuna fiyatı yazın.',
          '"Kaydet" butonuna basın. Artık randevu ve kasa formlarında görünür.',
        ],
      },
      {
        heading: "Hizmet nasıl aktif/pasif yapılır ve düzenlenir?",
        steps: [
          'Hizmet listesindeki ilgili satırın yanındaki "Düzenle" butonuna basın.',
          'Bilgileri değiştirip "Kaydet" deyin.',
          '"Pasif Yap" seçeneğiyle hizmeti geçici olarak kapatabilirsiniz. Pasif hizmetler randevu formunda görünmez.',
        ],
      },
    ],
  },
  {
    id: "kampanyalar",
    title: "12. Kampanya Yönetimi",
    icon: "📢",
    content: [
      {
        heading: "Yeni kampanya nasıl oluşturulur?",
        steps: [
          'Sol menüden "Kampanyalar" bağlantısına tıklayın.',
          '"Yeni Kampanya" butonuna basın.',
          '"Başlık" kutusuna kampanya adını yazın (örn: Yaz İndirimi).',
          '"Açıklama" kutusuna kampanya detayını yazın.',
          '"Buton Metni" kutusuna buton yazısını yazın (örn: Hemen Randevu Al).',
          '"Başlangıç Tarihi" ve "Bitiş Tarihi" kutularından tarihleri seçin.',
          '"Ana Sayfada Göster" kutucuğunu işaretlerseniz kampanya sitenizin ana sayfasında görünür.',
          '"Aktif" seçeneği kampanyanın şu an yayında olup olmadığını belirler.',
          '"Kaydet" butonuna basın.',
        ],
      },
    ],
  },
  {
    id: "saatler",
    title: "13. Çalışma Saatleri",
    icon: "🕐",
    content: [
      {
        heading: "Çalışma saatleri nasıl ayarlanır?",
        steps: [
          'Sol menüden "Çalışma Saatleri" bağlantısına tıklayın.',
          'Her çalışan için haftalık çalışma programı görüntülenir.',
          '"Pazartesi", "Salı" gibi gün başlıklarının altında "Başlangıç" ve "Bitiş" saatlerini girin.',
          '"Kapalı" kutucuğunu işaretlediğiniz gün o berber o gün randevu almaz.',
          '"Kaydet" butonuna basın. Değişiklikler randevu sistemine yansır.',
        ],
      },
    ],
  },
  {
    id: "ayarlar",
    title: "14. Ayarlar",
    icon: "⚙️",
    content: [
      {
        heading: "İşletme bilgileri nasıl güncellenir?",
        steps: [
          'Sol menüden "Ayarlar" bağlantısına tıklayın.',
          '"İşletme Adı", "Telefon", "Adres" gibi alanları düzenleyin.',
          '"Kaydet" butonuna basın.',
        ],
      },
      {
        heading: "Google Calendar nasıl açılır?",
        steps: [
          '"Ayarlar" sayfasında Google Calendar bölümünü bulun.',
          'Google hesabınızla bağlantı yapmak için ilgili butona basın.',
          '"Aktif" seçeneğini açınca yeni randevular Google Takviminize otomatik eklenir.',
        ],
      },
    ],
  },
  {
    id: "hatalar",
    title: "15. En Sık Yapılan Hatalar",
    icon: "⚠️",
    content: [
      {
        heading: "Sık karşılaşılan durumlar ve çözümleri",
        steps: [
          'Müşteri iki kere kaydolduysa: Müşteri detay sayfasında "Müşteri Birleştir" butonu ile iki kaydı tek kayıtta birleştirin. Bölüm 10\'a bakın.',
          'Müşteri ödeme yapmadıysa: Satış kaydederken "Ödenen ₺" kutusuna 0 yazın. Kayıt veresiyeye düşer. Ödeme gelince "Veresiye Defteri"nden tahsilat yapın.',
          'Yanlış fiyat girildiyse: Satışı "Void" (iptal) edin, tekrar doğru tutar ile girin.',
          'Yanlış satış girildiyse: "Günlük Kasa" sayfasında satırın sağındaki kırmızı "Void" butonuna basın.',
          'Randevu yanlış tarihe girildiyse: "Randevular" sayfasında randevuyu iptal edin ve doğru tarihte yeniden oluşturun.',
          'Çalışan yüzdesi yanlışsa: "Çalışanlar" menüsünden ilgili kişinin detay sayfasına gidin, "Profili Düzenle" ile düzeltin.',
        ],
      },
    ],
  },
  {
    id: "gunluk-akis",
    title: "16. Günlük Kullanım Sırası",
    icon: "📋",
    content: [
      {
        heading: "Sabah yapılacaklar",
        steps: [
          '"Dashboard" sayfasını açın.',
          'Bugünkü bekleyen randevuları kontrol edin.',
          'Onaylanmamış randevular varsa "Onayla" butonuna basın.',
        ],
      },
      {
        heading: "Gün içinde yapılacaklar",
        steps: [
          'Randevulu müşteri geldiğinde: "Randevular" sayfasında o randevuyu bulun, "Tamamla" butonuna basın, kasa kaydını oluşturun.',
          'Randevusuz müşteri geldiğinde: "Günlük Kasa" sayfasından "Yeni Satış" ile direkt kasa kaydı girin.',
          'Müşteri veresiye bıraktıysa: "Ödenen ₺" kutusuna ne kadar verdiğini yazın, kalanı sistem otomatik veresiyeye atar.',
        ],
      },
      {
        heading: "Akşam yapılacaklar",
        steps: [
          '"Gün Sonu" sayfasını açın.',
          'Günün giderlerini ekleyin (kira, malzeme, elektrik vb.).',
          '"Net Kasa" rakamını kontrol edin.',
          '"Hakedişler" sayfasından çalışan paylarını kontrol edin.',
          'Veresiye varsa "Veresiye Defteri"nden durumu gözden geçirin.',
        ],
      },
    ],
  },
];

const quickLinks = [
  { href: "/admin/randevular", label: "Randevulara Git", icon: "📅" },
  { href: "/admin/kasa", label: "Günlük Kasaya Git", icon: "🏧" },
  { href: "/admin/veresiye", label: "Veresiye Defterine Git", icon: "📒" },
  { href: "/admin/gun-sonu", label: "Gün Sonuna Git", icon: "🌙" },
  { href: "/admin/hakedisler", label: "Hakedişlere Git", icon: "💰" },
  { href: "/admin/musteriler", label: "Müşterilere Git", icon: "👥" },
  { href: "/admin/calisanlar", label: "Çalışanlara Git", icon: "👤" },
];

export default function RehberPage() {
  return (
    <div className="p-6 md:p-8 max-w-4xl">
      {/* Başlık */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 bg-[#c9762c]/15 border border-[#c9762c]/25 rounded-lg flex items-center justify-center text-lg">📖</div>
          <h1 className="text-2xl font-black">BOSS Yönetim Paneli Kullanım Rehberi</h1>
        </div>
        <p className="text-[#6b7280] text-sm">
          Bu rehber, BOSS admin panelini ilk kez kullananlar için hazırlanmıştır.
          Her işlem adım adım anlatılmıştır.
        </p>
      </div>

      {/* Hızlı Bağlantılar */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5 mb-8">
        <h2 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-4">Hızlı Erişim</h2>
        <div className="flex flex-wrap gap-2">
          {quickLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] hover:bg-[#c9762c]/10 border border-[#2a2a2a] hover:border-[#c9762c]/30 rounded-lg text-sm text-[#9ca3af] hover:text-[#c9762c] transition-all"
            >
              <span>{link.icon}</span>
              <span>{link.label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* İçindekiler */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5 mb-8">
        <h2 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-4">İçindekiler</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-[#6b7280] hover:text-white hover:bg-[#1e1e1e] transition-all"
            >
              <span className="text-base">{s.icon}</span>
              <span>{s.title}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Bölümler */}
      <div className="space-y-8">
        {sections.map((section) => (
          <div
            key={section.id}
            id={section.id}
            className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden scroll-mt-6"
          >
            {/* Bölüm başlığı */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2a2a2a] bg-[#111]">
              <span className="text-xl">{section.icon}</span>
              <h2 className="font-bold text-white">{section.title}</h2>
            </div>

            <div className="p-6 space-y-6">
              {section.content.map((block, bi) => (
                <div key={bi}>
                  <h3 className="text-sm font-semibold text-[#c9762c] mb-3">{block.heading}</h3>
                  <ol className="space-y-2">
                    {block.steps.map((step, si) => (
                      <li key={si} className="flex gap-3">
                        <span className="shrink-0 w-5 h-5 bg-[#c9762c]/15 border border-[#c9762c]/20 rounded text-[10px] font-bold text-[#c9762c] flex items-center justify-center mt-0.5">
                          {si + 1}
                        </span>
                        <p className="text-sm text-[#9ca3af] leading-relaxed">{step}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Alt bilgi */}
      <div className="mt-8 p-5 bg-[#141414] border border-[#2a2a2a] rounded-xl text-center">
        <p className="text-sm text-[#6b7280]">
          Bir sorunuz mu var? Adım adım deneyerek öğrenin — yanlış bir şey yapmanız durumunda sistemi bozamazsınız.
        </p>
      </div>
    </div>
  );
}
