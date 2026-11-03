# Chaxini · Fantasy Basketbol Takvimi

Chaxini, NBA fantasy basketbol oyuncuları için maç takvimini, lig kadrolarını ve oyuncu istatistiklerini bir araya getiren bir web uygulamasıdır. Haftalık maç planlamasını kolaylaştırır ve takımın ihtiyaçlarına göre oyuncu önerileri sunar.

## Özellikler

- **Sezon özeti:** Takımların haftalara göre maç sayılarını gösterir.
- **Haftalık takvim:** Tarih ve hafta seçimi, takım arama ve favorilerle maç programını incelemeyi sağlar.
- **Fikstür analizi:** Art arda maçları ve dört günde üç maç oynayan takımları listeler.
- **Takım analizi:** Herkese açık Yahoo NBA lig bağlantısıyla lig takımlarını, kadroları ve boştaki oyuncuları yükler.
- **Takım takviyesi:** Seçilen istatistik kategorilerine göre uygun oyuncuları önerir.
- **Takım verimlileştirme:** Kalan maç günlerini ve kadro kapasitesini değerlendirerek oyuncu değişikliği seçenekleri sunar. Oyuncuların ortalamaları, yön okları ve maç günleri aynı tabloda karşılaştırılır.

## Veriler ve hesaplamalar

Oyuncu istatistikleri, lig kadroları ve oyuncuların müsaitlik bilgileri **Yahoo Fantasy’nin resmî sayfalarından**; NBA takımlarının tamamlanan maç sayıları ve günlük maç durumları **ESPN’nin resmî veri servislerinden** alınır.

Oyuncu ortalamaları, NBA takımının tamamladığı tüm maçlar üzerinden hesaplanır; oynanmayan maçlar sıfır olarak değerlendirilir. FG ve FT yüzdeleri isabet/deneme oranını korur.

Takviye önerilerinde en az **%65 maç katılımı** ve **10 dakika ortalama süre** şartı aranır. NA durumundaki oyuncular değerlendirmeye alınmaz. Öneriler tahmin niteliğindedir; Yahoo hesabında otomatik işlem yapılmaz.

## Kullanım

Site Türkçe ve İngilizce kullanılabilir. Telefonda ana ekrana eklenerek bağımsız uygulama görünümünde açılabilir. Kaydedilmiş takvim ve lig verileri çevrimdışı incelenebilir; güncel lig verilerini almak için internet bağlantısı ve **“Ligi yükle / yenile”** işlemi gerekir.

**[Chaxini’yi aç →](https://chaxini-fantasy-basketbol-takvim.onrender.com)**
